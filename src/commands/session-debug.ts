import { findSessionByKey } from './sessions';
import { readLatestRuntimeDiagnostic } from '../runtime/diagnostics';

export async function sessionDebugCommand(
  sessionKeyOrId: string,
  options?: { json?: boolean }
): Promise<number> {
  const found = findSessionByKey(sessionKeyOrId);
  const sessionKey = found?.session.sessionKey || sessionKeyOrId;
  const trace = readLatestRuntimeDiagnostic(sessionKey);
  if (!trace) {
    console.error(`Error: No runtime diagnostics found for session: ${sessionKeyOrId}`);
    return 1;
  }

  const result = {
    sessionKey,
    traceFile: trace.traceFile,
    events: trace.events,
  };
  if (options?.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(`Session: ${sessionKey}`);
  console.log(`Trace:   ${trace.traceFile}`);
  console.log('Events:');
  for (const event of trace.events) {
    console.log(`  ${JSON.stringify(event)}`);
  }
  return 0;
}
