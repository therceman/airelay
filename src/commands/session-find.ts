import { findSessionByKey } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { fetchSessionViewport } from './session-viewport';
import { preflightVersionCheck } from './session-ipc';

interface FindResult {
  found: boolean;
  matchCount: number;
  matches: string[];
  error?: string;
}

export async function sessionFindCommand(
  sessionKeyOrId: string,
  pattern: string,
  options?: { json?: boolean; noWarn?: boolean }
): Promise<number> {
  if (!pattern) {
    console.error('Error: Pattern is required.');
    return 1;
  }

  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);

  // Preflight version parity check (blocking — hard-stop on major mismatch)
  const parity = await preflightVersionCheck(endpointPath);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  if (!options?.noWarn) {
    for (const w of parity.warnings) {
      console.warn(`Warning: ${w}`);
    }
  }

  const output = await fetchSessionViewport(endpointPath);

  const lower = pattern.toLowerCase();
  const matches = output.lines.filter((l) => l.toLowerCase().includes(lower));

  const result: FindResult = {
    found: matches.length > 0,
    matchCount: matches.length,
    matches,
    error: output.error,
  };

  if (options?.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.error && !result.found) {
    console.log(`Error: ${result.error}`);
  } else if (result.found) {
    console.log(`Found ${result.matchCount} match(es) for "${pattern}":`);
    for (const line of result.matches.slice(0, 10)) {
      console.log(`  ${line}`);
    }
    if (result.matches.length > 10) {
      console.log(`  ... and ${result.matches.length - 10} more`);
    }
  } else {
    const msg = result.error ? ` (${result.error})` : '';
    console.log(`No matches for "${pattern}" in session output${msg}`);
  }

  return result.found ? 0 : 1;
}
