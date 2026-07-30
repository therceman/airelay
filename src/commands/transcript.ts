import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getTranscriptStats, purgeTranscript, readTranscript } from '../utils/transcript';

export async function transcriptCommand(
  sessionKeyOrId: string,
  options?: {
    lines?: number;
    skip?: number;
    order?: 'asc' | 'desc';
    json?: boolean;
    stats?: boolean;
    purge?: boolean;
  }
): Promise<number> {
  await pruneStaleSessions();
  if (!findSessionByKey(sessionKeyOrId)) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  if (options?.purge) {
    const purged = purgeTranscript(sessionKeyOrId);
    if (options.json) {
      console.log(JSON.stringify({ session: sessionKeyOrId, purged }, null, 2));
    } else {
      console.log(
        purged ? `Purged transcript: ${sessionKeyOrId}` : `Transcript is empty: ${sessionKeyOrId}`
      );
    }
    return 0;
  }

  if (options?.stats) {
    const stats = getTranscriptStats(sessionKeyOrId);
    if (options.json) {
      console.log(JSON.stringify({ session: sessionKeyOrId, ...stats }, null, 2));
    } else {
      const duration =
        stats.oldestTimestamp && stats.newestTimestamp
          ? formatDuration(stats.newestTimestamp - stats.oldestTimestamp)
          : '0s';
      console.log(
        `Transcript ${sessionKeyOrId}: ${formatBytes(stats.bytes)} / ${formatBytes(stats.maxBytes)} ` +
          `| ${stats.snapshots} snapshots | ${stats.lines} lines | ${duration}`
      );
    }
    return 0;
  }

  const count = options?.lines || 20;
  const skip = options?.skip || 0;
  const snapshots = readTranscript(sessionKeyOrId);
  const allLines = snapshots.flatMap((snapshot) =>
    snapshot.lines.map((text) => ({ timestamp: snapshot.timestamp, text }))
  );
  const end = Math.max(0, allLines.length - skip);
  const start = Math.max(0, end - count);
  const selected = allLines.slice(start, end);
  const lines = options?.order === 'desc' ? selected.reverse() : selected;

  if (options?.json) {
    console.log(
      JSON.stringify(
        { session: sessionKeyOrId, lines, skip, order: options?.order || 'asc' },
        null,
        2
      )
    );
  } else {
    let lastTimestamp: number | undefined;
    for (const line of lines) {
      if (line.timestamp !== lastTimestamp) {
        console.log(`[${new Date(line.timestamp).toISOString()}]`);
        lastTimestamp = line.timestamp;
      }
      console.log(line.text);
    }
  }
  return 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${remainder}s`;
  return `${remainder}s`;
}
