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

  const result = await fetchSessionViewport(endpointPath);
  if (result.error) {
    console.error(`Error: ${result.error}`);
    return 1;
  }

  const lines = result.lines
    .map((line) => stripTerminalSequences(line).trimEnd())
    .filter((line) => line.length > 0)
    .slice(-(options?.lines || 20));
  if (options?.json) {
    console.log(JSON.stringify({ session: sessionKeyOrId, lines }, null, 2));
  } else {
    for (const line of lines) console.log(line);
  }
  return 0;
}

const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const OSC_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\][^\\u0007]*(?:\\u0007|${String.fromCharCode(27)}\\\\)`,
  'g'
);
const CONTROL_SEQUENCE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g'
);

function stripTerminalSequences(line: string): string {
  return line
    .replace(ANSI_SEQUENCE, '')
    .replace(OSC_SEQUENCE, '')
    .replace(CONTROL_SEQUENCE, (character) => (character === '\t' ? ' ' : ''));
}
