import net from 'net';
import os from 'os';
import path from 'path';
import { createJsonStore } from '../utils/json-store';
import type { RuntimeIdentity } from '../runtime/identity';
import { assertWorkspaceBinding, sameWorkspace, type SessionWorkspace } from '../workspace/binding';

export interface SessionEntry {
  id: string;
  name?: string;
  profile: string;
  lastUsed: number;
  cwd?: string;
  sessionKey?: string;
  controllerEndpoint?: string;
  /** @deprecated Use controllerPid/harnessPid/runtimeId instead. */
  pid?: number;
  runtimeId?: string;
  controllerPid?: number;
  harnessPid?: number | null;
  runtimeState?: RuntimeIdentity['runtimeState'];
  airelayVersion?: string;
  controllerProtocolVersion?: number;
  startedAt?: number;
  profileSessionId?: string;
  profileArgs?: string[];
  workspace?: SessionWorkspace;
}

export interface SessionsData {
  [profile: string]: SessionEntry[];
}

const store = createJsonStore<SessionsData>({
  envVar: 'AIRELAY_SESSIONS',
  defaultPath: path.join(os.homedir(), '.airelay', 'sessions.json'),
});

export function loadSessions(): SessionsData {
  const sessions = store.load();
  if (
    !sessions ||
    typeof sessions !== 'object' ||
    Array.isArray(sessions) ||
    Object.values(sessions).some((entries) => !Array.isArray(entries))
  )
    throw new Error('Invalid session registry; restore a reviewed backup before launching.');
  return sessions;
}

function saveSessions(sessions: SessionsData): void {
  store.save(sessions);
}

export function getSessionsPath(): string {
  return store.getPath();
}

export function addSession(
  profile: string,
  sessionId: string,
  cwd?: string,
  sessionKey?: string,
  controllerEndpoint?: string,
  pid?: number,
  airelayVersion?: string,
  controllerProtocolVersion?: number,
  startedAt?: number,
  profileSessionId?: string,
  profileArgs?: string[],
  workspace?: SessionWorkspace,
  runtime?: RuntimeIdentity
): void {
  return store.transaction(() => {
    const sessions = loadSessions();
    if (sessionKey) {
      assertWorkspaceBinding(sessionKey, workspace, Object.values(sessions).flat());
      if (workspace) {
        for (const entries of Object.values(sessions)) {
          for (const entry of entries.filter(
            (e) => e.sessionKey === sessionKey && e.id !== sessionId
          )) {
            if (entry.controllerPid) {
              try {
                process.kill(entry.controllerPid, 0);
              } catch {
                continue;
              }
              throw new Error(
                `Session key ${sessionKey} already has a live controller; use airelay attach.`
              );
            }
          }
        }
        for (const name of Object.keys(sessions))
          sessions[name] = sessions[name].filter(
            (e) => e.sessionKey !== sessionKey || e.id === sessionId
          );
      }
    }
    const sessionTimestamp = startedAt ?? Date.now();
    if (!sessions[profile]) {
      sessions[profile] = [];
    }

    const existingIndex = sessions[profile].findIndex((s) => s.id === sessionId);
    if (existingIndex !== -1) {
      if (!sameWorkspace(sessions[profile][existingIndex].workspace, workspace))
        throw new Error(
          'Saved session has a different Workspace binding; use a new session or explicit migration.'
        );
      sessions[profile][existingIndex].lastUsed = sessionTimestamp;
      if (cwd) {
        sessions[profile][existingIndex].cwd = cwd;
      }
      if (sessionKey) {
        sessions[profile][existingIndex].sessionKey = sessionKey;
      }
      if (controllerEndpoint) {
        sessions[profile][existingIndex].controllerEndpoint = controllerEndpoint;
      }
      if (pid !== undefined) {
        sessions[profile][existingIndex].pid = pid;
      }
      if (airelayVersion) {
        sessions[profile][existingIndex].airelayVersion = airelayVersion;
      }
      if (controllerProtocolVersion !== undefined) {
        sessions[profile][existingIndex].controllerProtocolVersion = controllerProtocolVersion;
      }
      if (startedAt !== undefined) {
        sessions[profile][existingIndex].startedAt = startedAt;
      }
      if (profileSessionId) {
        sessions[profile][existingIndex].profileSessionId = profileSessionId;
      }
      if (profileArgs) {
        sessions[profile][existingIndex].profileArgs = profileArgs;
      }
      if (workspace) sessions[profile][existingIndex].workspace = workspace;
      if (runtime) Object.assign(sessions[profile][existingIndex], runtime);
    } else {
      sessions[profile].push({
        id: sessionId,
        profile,
        lastUsed: sessionTimestamp,
        cwd,
        sessionKey,
        controllerEndpoint,
        pid,
        airelayVersion,
        controllerProtocolVersion,
        startedAt,
        profileSessionId,
        profileArgs,
        ...(workspace ? { workspace } : {}),
        ...runtime,
      });
    }

    sessions[profile].sort((a, b) => b.lastUsed - a.lastUsed);
    const bound = sessions[profile].filter((s) => s.workspace);
    if (bound.length > 50)
      throw new Error(
        'Workspace session limit reached; explicitly remove unused saved sessions first.'
      );
    sessions[profile] = [
      ...bound,
      ...sessions[profile].filter((s) => !s.workspace).slice(0, 50 - bound.length),
    ].sort((a, b) => b.lastUsed - a.lastUsed);
    saveSessions(sessions);
  });
}

export function getSessions(profile: string): SessionEntry[] {
  const sessions = loadSessions();
  return sessions[profile] || [];
}

export function deleteSession(profile: string, sessionId: string): boolean {
  return store.transaction(() => {
    const sessions = loadSessions();
    if (!sessions[profile]) {
      return false;
    }

    const initialLength = sessions[profile].length;
    sessions[profile] = sessions[profile].filter((s) => s.id !== sessionId);

    if (sessions[profile].length !== initialLength) {
      saveSessions(sessions);
      return true;
    }
    return false;
  });
}

/** Keep the immutable workspace/native-resume binding after its runtime exits. */
export function finalizeSessionRuntime(profile: string, sessionId: string): void {
  return store.transaction(() => {
    const sessions = loadSessions();
    const entry = sessions[profile]?.find((s) => s.id === sessionId);
    if (!entry?.workspace) {
      deleteSession(profile, sessionId);
      return;
    }
    delete entry.controllerEndpoint;
    delete entry.controllerPid;
    delete entry.harnessPid;
    delete entry.pid;
    delete entry.runtimeId;
    delete entry.runtimeState;
    saveSessions(sessions);
  });
}

export function getSessionBindingEntries(): SessionEntry[] {
  return store.transaction(() => Object.values(loadSessions()).flat());
}

export function findSessionByKey(
  keyOrId: string
): { profile: string; session: SessionEntry } | null {
  const sessions = loadSessions();
  const matches: { profile: string; session: SessionEntry }[] = [];

  for (const [profile, profileSessions] of Object.entries(sessions)) {
    for (const session of profileSessions) {
      if (session.sessionKey && session.sessionKey === keyOrId) {
        matches.push({ profile, session });
      } else if (session.id === keyOrId) {
        matches.push({ profile, session });
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Multiple matches for the same key — prefer entries that
  // have a controllerEndpoint (active runtime), then by newest lastUsed.
  const withEndpoint = matches.filter((m) => m.session.controllerEndpoint);
  if (withEndpoint.length > 0) {
    withEndpoint.sort((a, b) => (b.session.lastUsed || 0) - (a.session.lastUsed || 0));
    return withEndpoint[0];
  }

  matches.sort((a, b) => (b.session.lastUsed || 0) - (a.session.lastUsed || 0));
  return matches[0];
}

export function updateSessionControllerEndpoint(keyOrId: string, endpoint: string): boolean {
  return store.transaction(() => {
    const sessions = loadSessions();

    for (const [, profileSessions] of Object.entries(sessions)) {
      const entry = profileSessions.find((s) => s.sessionKey === keyOrId || s.id === keyOrId);
      if (entry) {
        entry.controllerEndpoint = endpoint;
        entry.lastUsed = Date.now();
        saveSessions(sessions);
        return true;
      }
    }

    return false;
  });
}

export function updateSessionPid(keyOrId: string, pid: number): boolean {
  return store.transaction(() => {
    const sessions = loadSessions();
    for (const [, profileSessions] of Object.entries(sessions)) {
      const entry = profileSessions.find((s) => s.sessionKey === keyOrId || s.id === keyOrId);
      if (entry) {
        entry.pid = pid;
        saveSessions(sessions);
        return true;
      }
    }
    return false;
  });
}

export function updateSessionRuntime(
  profile: string,
  sessionId: string,
  runtime: RuntimeIdentity
): boolean {
  try {
    return store.transaction(() => {
      const sessions = loadSessions();
      const entry = sessions[profile]?.find((candidate) => candidate.id === sessionId);
      if (!entry) {
        return false;
      }

      entry.runtimeId = runtime.runtimeId;
      entry.controllerPid = runtime.controllerPid;
      entry.harnessPid = runtime.harnessPid;
      entry.runtimeState = runtime.runtimeState;
      entry.lastUsed = Date.now();
      saveSessions(sessions);
      return true;
    });
  } catch {
    // Liveness metadata remains best effort; initial Workspace reservation is strict.
    return false;
  }
}

/**
 * Probe a controller endpoint with a real socket connect + IPC ping.
 * Returns true if the controller responds, false otherwise.
 */
export function isControllerReachable(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      socket.destroy();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 1000);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 'prune-1', method: 'ping' }) + '\n');
    });

    let buffer = '';
    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        cleanup();
        try {
          const parsed = JSON.parse(buffer.slice(0, idx));
          if (parsed.id === 'prune-1' && parsed.type === 'success') {
            resolve(true);
          } else {
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      }
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    if (process.platform === 'win32') {
      socket.connect(endpoint);
    } else {
      socket.connect({ path: endpoint });
    }
  });
}

/**
 * Prune stale sessions whose PID is dead AND controller endpoint is unreachable.
 * Returns the number of pruned entries. Safe to call on every listing.
 */
export async function pruneStaleSessions(): Promise<number> {
  const sessions = loadSessions();
  const staleEntries: SessionEntry[] = [];

  for (const entries of Object.values(sessions)) {
    for (const entry of entries) {
      const entryPid = entry.controllerPid ?? entry.pid;
      const hasPid = entryPid !== undefined && entryPid !== null;
      let pidAlive = !hasPid;
      if (hasPid) {
        try {
          process.kill(entryPid, 0);
          pidAlive = true;
        } catch {
          pidAlive = false;
        }
      }

      let stale = false;

      if (!pidAlive && hasPid) {
        if (entry.controllerEndpoint) {
          try {
            const reachable = await isControllerReachable(entry.controllerEndpoint);
            stale = !reachable;
          } catch {
            stale = true;
          }
        } else {
          stale = true;
        }
      }

      if (stale) {
        staleEntries.push(entry);
      }
    }
  }
  return store.transaction(() => {
    const current = loadSessions();
    let pruned = 0;
    for (const stale of staleEntries) {
      const entry = current[stale.profile]?.find(
        (candidate) =>
          candidate.id === stale.id && JSON.stringify(candidate) === JSON.stringify(stale)
      );
      if (!entry) continue;
      if (entry.workspace) {
        delete entry.controllerEndpoint;
        delete entry.controllerPid;
        delete entry.harnessPid;
        delete entry.pid;
        delete entry.runtimeId;
        delete entry.runtimeState;
      } else
        current[stale.profile] = current[stale.profile].filter((candidate) => candidate !== entry);
      pruned++;
    }
    if (pruned) saveSessions(current);
    return pruned;
  });
}

export function removeSessionByKey(key: string): boolean {
  return store.transaction(() => {
    const sessions = loadSessions();

    for (const [profile, profileSessions] of Object.entries(sessions)) {
      const idx = profileSessions.findIndex((s) => s.sessionKey === key);
      if (idx !== -1) {
        profileSessions.splice(idx, 1);
        sessions[profile] = profileSessions;
        saveSessions(sessions);
        return true;
      }
    }

    return false;
  });
}
