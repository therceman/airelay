import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getTranscriptStats, readTranscript } from '../utils/transcript';

export async function transcriptCommand(
  sessionKeyOrId: string,
  options?: {
    lines?: number;
    skip?: number;
    order?: 'asc' | 'desc';
    json?: boolean;
    stats?: boolean;
  }
): Promise<number> {
  await pruneStaleSessions();
  if (!findSessionByKey(sessionKeyOrId)) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  if (options?.stats) {
    const stats = getTranscriptStats(sessionKeyOrId);
    if (options.json) {
      console.log(JSON.stringify({ session: sessionKeyOrId, ...stats }, null, 2));
    } else {
      console.log(`Transcript: ${sessionKeyOrId}`);
      console.log(`  Path:      ${stats.path}`);
      console.log(`  Size:      ${stats.bytes} bytes`);
      console.log(`  Snapshots: ${stats.snapshots}`);
      console.log(`  Lines:     ${stats.lines}`);
      console.log(`  Limit:     ${stats.maxBytes} bytes`);
      if (stats.oldestTimestamp) {
        console.log(`  Oldest:    ${new Date(stats.oldestTimestamp).toISOString()}`);
      }
      if (stats.newestTimestamp) {
        console.log(`  Newest:    ${new Date(stats.newestTimestamp).toISOString()}`);
      }
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
