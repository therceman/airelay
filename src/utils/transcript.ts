import fs from 'fs';
import os from 'os';
import path from 'path';

export interface TranscriptSnapshot {
  timestamp: number;
  lines: string[];
}

function getTranscriptDir(): string {
  return process.env.AIRELAY_TRANSCRIPTS_DIR || path.join(os.homedir(), '.airelay', 'transcripts');
}

function getTranscriptMaxBytes(): number {
  const configured = Number(process.env.AIRELAY_TRANSCRIPT_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100 * 1024 * 1024;
}

export function getTranscriptPath(sessionKey: string): string {
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getTranscriptDir(), `${safeKey}.jsonl`);
}

export function appendTranscriptSnapshot(sessionKey: string, lines: string[]): void {
  const filePath = getTranscriptPath(sessionKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const snapshot: TranscriptSnapshot = { timestamp: Date.now(), lines };
  const record = `${JSON.stringify(snapshot)}\n`;
  fs.appendFileSync(filePath, record, 'utf8');

  const maxBytes = getTranscriptMaxBytes();
  // Compact in batches so normal output only appends and does not rewrite a large file.
  if (fs.statSync(filePath).size > maxBytes + Math.floor(maxBytes * 0.1)) {
    const records = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    let size = 0;
    const retained: string[] = [];
    for (let i = records.length - 1; i >= 0 && size < maxBytes; i--) {
      const recordSize = Buffer.byteLength(`${records[i]}\n`, 'utf8');
      retained.unshift(records[i]);
      size += recordSize;
    }
    fs.writeFileSync(filePath, `${retained.join('\n')}\n`, 'utf8');
  }
}

export function readTranscript(sessionKey: string): TranscriptSnapshot[] {
  const filePath = getTranscriptPath(sessionKey);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const snapshot = JSON.parse(line) as TranscriptSnapshot;
        return Array.isArray(snapshot.lines) ? [snapshot] : [];
      } catch {
        return [];
      }
    });
}

export function getTranscriptStats(sessionKey: string): {
  path: string;
  bytes: number;
  snapshots: number;
  lines: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  maxBytes: number;
} {
  const filePath = getTranscriptPath(sessionKey);
  const snapshots = readTranscript(sessionKey);
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : undefined;
  return {
    path: filePath,
    bytes: stat?.size || 0,
    snapshots: snapshots.length,
    lines: snapshots.reduce((total, snapshot) => total + snapshot.lines.length, 0),
    oldestTimestamp: snapshots[0]?.timestamp,
    newestTimestamp: snapshots.at(-1)?.timestamp,
    maxBytes: getTranscriptMaxBytes(),
  };
}

export function purgeTranscript(sessionKey: string): boolean {
  const filePath = getTranscriptPath(sessionKey);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
