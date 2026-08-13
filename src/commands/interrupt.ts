import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { preflightVersionCheck, sendControllerRequest } from './session-ipc';
import type { InterruptResult } from '../runtime/interrupt';

export async function interruptCommand(
  sessionKeyOrId: string,
  options?: { json?: boolean; noWarn?: boolean }
): Promise<number> {
  await pruneStaleSessions();
  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpoint = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);
  const parity = await preflightVersionCheck(endpoint);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  if (!options?.noWarn) {
    for (const warning of parity.warnings) console.warn(`Warning: ${warning}`);
  }

  try {
    const response = await sendControllerRequest(endpoint, {
      id: `interrupt-${Date.now()}`,
      method: 'session.interrupt',
    });
    if (response.type === 'error') {
      const message = response.error?.message || 'Controller rejected interrupt';
      console.error(`Error: ${message}`);
      return 1;
    }

    const result = response.data as InterruptResult | undefined;
    if (!result?.outcome) {
      console.error('Error: Controller returned an invalid interrupt result.');
      return 1;
    }
    if (options?.json) {
      console.log(JSON.stringify({ session: sessionKeyOrId, ...result }, null, 2));
    } else {
      console.log(`Interrupt: ${result.outcome}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }
    return ['interrupt_acknowledged', 'already_idle', 'no_active_turn'].includes(result.outcome)
      ? 0
      : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    return 1;
  }
}
