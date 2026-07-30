import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionViewport } from './session-viewport';
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

  const [viewportResult, outputResult] = await Promise.all([
    fetchSessionViewport(endpointPath),
    fetchSessionOutput(endpointPath),
  ]);
  if (viewportResult.error) {
    console.error(`Error: ${viewportResult.error}`);
    return 1;
  }

  const lines = viewportResult.lines
    .map((line) => stripTerminalSequences(line).trimEnd())
    .filter((line) => line.length > 0)
    .slice(-(options?.lines || 20));
  const capacityMessage = 'Selected model is at capacity. Please try a different model.';
  const rawOutput = outputResult.lines.map(stripTerminalSequences).join('\n');
  if (rawOutput.includes(capacityMessage)) {
    const warningIndex = lines.findIndex((line) => line.trim() === '⚠');
    const filteredLines = lines.filter(
      (line, index) => !line.trim().startsWith('⚠') || index === warningIndex
    );
    if (warningIndex >= 0) {
      const filteredWarningIndex = filteredLines.findIndex((line) => line.trim() === '⚠');
      filteredLines[filteredWarningIndex] = `⚠ ${capacityMessage}`;
    }
    lines.splice(0, lines.length, ...filteredLines);
  }
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
