import net from 'net';
import os from 'os';
import path from 'path';
import { createJsonStore } from '../utils/json-store';

export interface SessionEntry {
  id: string;
  name?: string;
  profile: string;
  lastUsed: number;
  cwd?: string;
  sessionKey?: string;
  controllerEndpoint?: string;
  pid?: number;
  airelayVersion?: string;
  controllerProtocolVersion?: number;
  startedAt?: number;
  profileSessionId?: string;
  profileArgs?: string[];
}

export interface SessionsData {
  [profile: string]: SessionEntry[];
}

const store = createJsonStore<SessionsData>({
  envVar: 'AIRELAY_SESSIONS',
  defaultPath: path.join(os.homedir(), '.airelay', 'sessions.json'),
});

export function loadSessions(): SessionsData {
  return store.load();
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
  profileArgs?: string[]
): void {
  const sessions = loadSessions();
  if (!sessions[profile]) {
    sessions[profile] = [];
  }

  const existingIndex = sessions[profile].findIndex((s) => s.id === sessionId);
  if (existingIndex !== -1) {
    sessions[profile][existingIndex].lastUsed = Date.now();
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
  } else {
    sessions[profile].push({
      id: sessionId,
      profile,
      lastUsed: Date.now(),
      cwd,
      sessionKey,
      controllerEndpoint,
      pid,
      airelayVersion,
      controllerProtocolVersion,
      startedAt,
      profileSessionId,
      profileArgs,
    });
  }

  sessions[profile].sort((a, b) => b.lastUsed - a.lastUsed);
  sessions[profile] = sessions[profile].slice(0, 50);
  saveSessions(sessions);
}

export function getSessions(profile: string): SessionEntry[] {
  const sessions = loadSessions();
  return sessions[profile] || [];
}

export function deleteSession(profile: string, sessionId: string): boolean {
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
}

export function findSessionByKey(
  keyOrId: string
): { profile: string; session: SessionEntry } | null {
  const sessions = loadSessions();

  for (const [profile, profileSessions] of Object.entries(sessions)) {
    for (const session of profileSessions) {
      if (session.sessionKey && session.sessionKey === keyOrId) {
        return { profile, session };
      }
      if (session.id === keyOrId) {
        return { profile, session };
      }
    }
  }

  return null;
}

export function updateSessionControllerEndpoint(keyOrId: string, endpoint: string): boolean {
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
}

export function updateSessionPid(keyOrId: string, pid: number): boolean {
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
  let pruned = 0;

  for (const [profile, entries] of Object.entries(sessions)) {
    const alive: SessionEntry[] = [];
    for (const entry of entries) {
      const entryPid = entry.pid;
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
        pruned++;
        continue;
      }
      alive.push(entry);
    }
    sessions[profile] = alive;
  }

  if (pruned > 0) {
    saveSessions(sessions);
  }
  return pruned;
}

export function removeSessionByKey(key: string): boolean {
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
}
