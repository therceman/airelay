import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionViewport } from './session-viewport';
import { fetchSessionOutput } from './session-output';
import { preflightVersionCheck } from './session-ipc';

export async function tailCommand(
  sessionKeyOrId: string,
  options?: { lines?: number; skip?: number; json?: boolean; noWarn?: boolean }
): Promise<number> {
  await pruneStaleSessions();
  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);
  const parity = await preflightVersionCheck(endpointPath);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  if (!options?.noWarn) {
    for (const warning of parity.warnings) console.warn(`Warning: ${warning}`);
  }

  const count = options?.lines || 20;
  const skip = options?.skip || 0;
  const viewportResult = await fetchSessionViewport(endpointPath);
  if (viewportResult.error) {
    console.error(`Error: ${viewportResult.error}`);
    return 1;
  }

  // A tiny terminal can expose fewer rows than requested even though the
  // controller still has its bounded output history. Keep the normal tail
  // semantics for a usable live viewport, and fall back only when it cannot
  // satisfy the requested range.
  let sourceLines = viewportResult.lines;
  if (sourceLines.length < count + skip) {
    const outputResult = await fetchSessionOutput(endpointPath);
    if (!outputResult.error && outputResult.lines.length > sourceLines.length) {
      sourceLines = outputResult.lines;
    }
  }

  const end = skip === 0 ? undefined : -skip;
  const lines = sourceLines.slice(-(count + skip), end);
  if (options?.json) {
    console.log(JSON.stringify({ session: sessionKeyOrId, lines }, null, 2));
  } else {
    for (const line of lines) console.log(line);
  }
  return 0;
}
