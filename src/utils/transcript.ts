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

export function getTranscriptPath(sessionKey: string): string {
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getTranscriptDir(), `${safeKey}.jsonl`);
}

export function appendTranscriptSnapshot(sessionKey: string, lines: string[]): void {
  const filePath = getTranscriptPath(sessionKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const snapshot: TranscriptSnapshot = { timestamp: Date.now(), lines };
  fs.appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
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
