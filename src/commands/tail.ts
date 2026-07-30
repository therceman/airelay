import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionViewport } from './session-viewport';
import { preflightVersionCheck } from './session-ipc';

export async function tailCommand(
  sessionKeyOrId: string,
  options?: { lines?: number; json?: boolean; noWarn?: boolean }
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

  const viewportResult = await fetchSessionViewport(endpointPath);
  if (viewportResult.error) {
    console.error(`Error: ${viewportResult.error}`);
    return 1;
  }

  const lines = viewportResult.lines.slice(-(options?.lines || 20));
  if (options?.json) {
    console.log(JSON.stringify({ session: sessionKeyOrId, lines }, null, 2));
  } else {
    for (const line of lines) console.log(line);
  }
  return 0;
}
