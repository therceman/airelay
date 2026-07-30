import { findSessionByKey, pruneStaleSessions } from './sessions';
import { readTranscript } from '../utils/transcript';

export async function transcriptCommand(
  sessionKeyOrId: string,
  options?: { lines?: number; order?: 'asc' | 'desc'; page?: number; json?: boolean }
): Promise<number> {
  await pruneStaleSessions();
  if (!findSessionByKey(sessionKeyOrId)) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  const count = options?.lines || 20;
  const page = options?.page || 1;
  const snapshots = readTranscript(sessionKeyOrId);
  const allLines = snapshots.flatMap((snapshot) =>
    snapshot.lines.map((text) => ({ timestamp: snapshot.timestamp, text }))
  );
  const ordered = options?.order === 'desc' ? [...allLines].reverse() : allLines;
  const start = (page - 1) * count;
  const lines = ordered.slice(start, start + count);

  if (options?.json) {
    console.log(
      JSON.stringify(
        { session: sessionKeyOrId, lines, page, order: options?.order || 'asc' },
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
