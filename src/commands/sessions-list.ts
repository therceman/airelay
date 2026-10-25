import os from 'os';
import { loadSessions, pruneStaleSessions } from './sessions';
import type { SessionWorkspace } from '../workspace/binding';

function normalizeCwd(cwd?: string): string {
  if (!cwd) return '';
  const home = os.homedir();
  if (cwd.startsWith(home)) {
    return '~' + cwd.slice(home.length);
  }
  return cwd;
}

export interface SessionRow {
  workspace?: SessionWorkspace;
  sessionId: string;
  profile: string;
  cwd: string;
  sessionKey?: string;
  controllerEndpoint?: string;
  lastUsed: number;
  pid?: number;
  active?: boolean;
}

/** Current working directory as an absolute path, for --cwd filtering */
let _currentCwd = process.cwd();

/**
 * Override current cwd for testing. Returns the previous value.
 */
export function setCurrentCwd(cwd: string): string {
  const prev = _currentCwd;
  _currentCwd = cwd;
  return prev;
}

async function flattenSessions(): Promise<SessionRow[]> {
  await pruneStaleSessions();
  const data = loadSessions();
  const rows: SessionRow[] = [];

  for (const [profile, entries] of Object.entries(data)) {
    for (const entry of entries) {
      rows.push({
        sessionId: entry.id,
        profile,
        cwd: normalizeCwd(entry.cwd),
        sessionKey: entry.sessionKey,
        controllerEndpoint: entry.controllerEndpoint,
        lastUsed: entry.lastUsed,
        pid: entry.pid,
        ...(entry.workspace ? { workspace: entry.workspace } : {}),
      });
    }
  }

  rows.sort((a, b) => b.lastUsed - a.lastUsed);
  return rows;
}

export async function sessionsListCommand(flags?: {
  json?: boolean;
  active?: boolean;
  cwd?: boolean;
}): Promise<void> {
  let rows = await flattenSessions();

  if (flags?.cwd) {
    rows = rows.filter((r) => r.cwd === normalizeCwd(_currentCwd));
  }

  if (flags?.active) {
    const results = await Promise.all(
      rows.map(async (row) => {
        if (row.controllerEndpoint) {
          const { isControllerReachable } = await import('./sessions');
          const reachable = await isControllerReachable(row.controllerEndpoint);
          return { ...row, active: reachable };
        }
        return { ...row, active: false };
      })
    );
    rows = results.filter((r) => r.active);
  }

  if (flags?.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const row of rows) {
    const activeTag = row.active ? ' [active]' : '';
    const cwdInfo = row.cwd ? ` @ ${row.cwd}` : '';
    // Show key only when it differs from session ID (avoids redundant display)
    const keyInfo =
      row.sessionKey && row.sessionKey !== row.sessionId ? ` (key: ${row.sessionKey})` : '';
    console.log(`${row.sessionId}${keyInfo}${cwdInfo}${activeTag}`);
    console.log(`  profile: ${row.profile}`);
    if (row.workspace)
      console.log(`  workspace: ${row.workspace.selector} (${row.workspace.path})`);
    if (row.pid !== undefined) {
      console.log(`  pid: ${row.pid}`);
    }
    if (row.lastUsed) {
      console.log(`  last used: ${new Date(row.lastUsed).toISOString()}`);
    }
  }
}

export async function sessionsListJson(): Promise<SessionRow[]> {
  return flattenSessions();
}
