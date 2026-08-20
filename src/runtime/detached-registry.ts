import os from 'os';
import path from 'path';
import { createJsonStore } from '../utils/json-store';
import { isControllerReachable } from '../commands/sessions';

/** Canonical record for a supervised detached runtime (one per runtimeId). */
export interface DetachedRuntimeEntry {
  /** Stable runtime identity (opaque, distinct from the sessionKey). */
  runtimeId: string;
  sessionKey: string;
  profile: string;
  cwd: string;
  /** PID of the supervised airelay runtime/controller process. */
  runtimePid: number;
  /** PID of the agent/PTY process owned by the runtime. */
  agentPid: number;
  controllerEndpoint: string;
  startedAt: number;
  /** Number of currently attached viewport clients (kept in sync by the runtime). */
  attachedClients: number;
}

interface DetachedRegistryData {
  [runtimeId: string]: DetachedRuntimeEntry;
}

const store = createJsonStore<DetachedRegistryData>({
  envVar: 'AIRELAY_DETACHED',
  defaultPath: path.join(os.homedir(), '.airelay', 'detached.json'),
});

function loadRegistry(): DetachedRegistryData {
  return store.load();
}

function saveRegistry(data: DetachedRegistryData): void {
  store.save(data);
}

export function getDetachedRegistryPath(): string {
  return store.getPath();
}

export function listDetachedEntries(): DetachedRuntimeEntry[] {
  const data = loadRegistry();
  return Object.values(data).sort((a, b) => a.startedAt - b.startedAt);
}

export function getDetachedEntry(runtimeId: string): DetachedRuntimeEntry | undefined {
  return loadRegistry()[runtimeId];
}

export function addDetachedEntry(entry: DetachedRuntimeEntry): void {
  const data = loadRegistry();
  data[entry.runtimeId] = entry;
  saveRegistry(data);
}

export function updateDetachedEntry(
  runtimeId: string,
  patch: Partial<Omit<DetachedRuntimeEntry, 'runtimeId'>>
): void {
  const data = loadRegistry();
  const existing = data[runtimeId];
  if (!existing) return;
  data[runtimeId] = { ...existing, ...patch };
  saveRegistry(data);
}

export function removeDetachedEntry(runtimeId: string): boolean {
  const data = loadRegistry();
  if (!data[runtimeId]) return false;
  delete data[runtimeId];
  saveRegistry(data);
  return true;
}

/**
 * Resolve a detached runtime by session key or runtime id.
 * Duplicate-key ambiguity is resolved deterministically: the most recently
 * started entry wins (ties broken by runtimeId asc so the result is stable).
 */
export function findDetachedBySessionKey(keyOrId: string): DetachedRuntimeEntry | null {
  const matches = listDetachedEntries().filter(
    (e) => e.sessionKey === keyOrId || e.runtimeId === keyOrId
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.startedAt - a.startedAt || (a.runtimeId < b.runtimeId ? -1 : 1));
  return matches[0];
}

export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isEntryReachable(entry: DetachedRuntimeEntry): Promise<boolean> {
  return isControllerReachable(entry.controllerEndpoint);
}

/**
 * Prune only entries that are confirmed stale: the controller endpoint is
 * unreachable AND the runtime PID is dead. If the PID is alive but the
 * controller is unreachable, the PID may have been reused by an unrelated
 * process, so the entry is kept (PID-reuse protection). Never kills anything.
 */
export async function pruneDetachedEntries(): Promise<number> {
  const entries = listDetachedEntries();
  let removed = 0;
  for (const entry of entries) {
    const reachable = await isEntryReachable(entry);
    if (reachable) continue;
    if (!isProcessAlive(entry.runtimePid)) {
      removeDetachedEntry(entry.runtimeId);
      removed += 1;
    }
  }
  return removed;
}
