import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionOutput } from './session-output';
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

  const result = await fetchSessionOutput(endpointPath);
  if (result.error) {
    console.error(`Error: ${result.error}`);
    return 1;
  }

  const lines = result.lines.slice(-(options?.lines || 20));
  if (options?.json) {
    console.log(JSON.stringify({ session: sessionKeyOrId, lines }, null, 2));
  } else {
    for (const line of lines) console.log(line);
  }
  return 0;
}
