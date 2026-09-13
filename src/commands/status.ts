import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectHarness, HarnessType } from '../utils/harness';
import { getAirelayVersion } from '../utils/version';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { loadConfig } from '../config/load';
import { findSessionByKey, isControllerReachable, loadSessions, SessionEntry } from './sessions';
import { fetchControllerInfo, sendControllerRequest, ControllerInfo } from './session-ipc';
import type { ActivityReason } from '../runtime/activity';
import type { RuntimeHealth, RuntimeIdentity } from '../runtime/identity';
import { collectProcessTree, listProcEntries, ProcEntry } from '../runtime/procfs';

const execFileAsync = promisify(execFile);
const DEFAULT_WATCH_INTERVAL_MS = 1000;
const IPC_TIMEOUT_MS = 3000;

export interface StatusActivity {
  state: 'busy' | 'idle' | null;
  reason: ActivityReason | null;
  lastInputAt: number | null;
  lastOutputAt: number | null;
  lastActivityAt: number | null;
  quietForMs: number | null;
}

export interface StatusProcess {
  pid: number | null;
  rssBytes: number | null;
}

export interface StatusHarnessProcess extends StatusProcess {
  treeRssBytes: number | null;
  treeProcessCount: number;
}

export interface StatusSnapshot {
  session: {
    key: string;
    profile: string;
    harness: HarnessType;
    nativeSessionId: string | null;
    cwd: string | null;
    state: RuntimeIdentity['runtimeState'] | 'unknown';
    activity: StatusActivity;
    attachedClients: number | null;
    uptimeMs: number | null;
  };
  runtime: {
    runtimeId: string | null;
    controllerPid: number | null;
    harnessPid: number | null;
    runtimeState: RuntimeIdentity['runtimeState'] | 'unknown';
    health: RuntimeHealth;
    controllerReachable: boolean;
    pingLatencyMs: number | null;
  };
  processes: {
    airelay: StatusProcess;
    harness: StatusHarnessProcess | null;
    bundleRssBytes: number | null;
  };
  buffers: {
    rawRingBytes: number | null;
    rawRingChunks: number | null;
    outputBufferLines: number | null;
    snapshotBufferLines: number | null;
    attachedClients: number | null;
  };
  versions: {
    airelay: string;
    harness: { name: HarnessType; version: string | null };
  };
}

interface Target {
  profile: string;
  session: SessionEntry;
}

export interface StatusOptions {
  json?: boolean;
  watch?: boolean;
  intervalMs?: number;
}

interface ControllerProbe {
  info: ControllerInfo | null;
  reachable: boolean;
  latencyMs: number | null;
}

interface VersionCache {
  get(executable: string, cwd: string | undefined, harness: HarnessType): Promise<string | null>;
}

function sessionKeyOf(entry: SessionEntry): string {
  return entry.sessionKey || entry.id;
}

function persistedRuntime(entry: SessionEntry): RuntimeIdentity | undefined {
  if (!entry.runtimeId || entry.controllerPid === undefined || !entry.runtimeState) {
    return undefined;
  }
  return {
    runtimeId: entry.runtimeId,
    controllerPid: entry.controllerPid,
    harnessPid: entry.harnessPid ?? null,
    runtimeState: entry.runtimeState,
  };
}

function allSessionTargets(): Target[] {
  const sessions = getSessionsFromAllProfiles();
  return sessions.flatMap(({ profile, entries }) =>
    entries.map((session) => ({ profile, session }))
  );
}

function getSessionsFromAllProfiles(): { profile: string; entries: SessionEntry[] }[] {
  // Keep this read-only. Status must not prune or rewrite the session registry.
  const data = loadSessions();
  return Object.entries(data).map(([profile, entries]) => ({ profile, entries }));
}

async function resolveTarget(
  explicitKey?: string
): Promise<
  | { target: Target }
  | { error: 'not_found' | 'no_live_sessions' | 'ambiguous'; candidates?: Target[]; value?: string }
> {
  if (explicitKey) {
    const found = findSessionByKey(explicitKey);
    return found ? { target: found } : { error: 'not_found', value: explicitKey };
  }

  const envKey = process.env.AIRELAY_SESSION_KEY?.trim();
  if (envKey) {
    const found = findSessionByKey(envKey);
    return found ? { target: found } : { error: 'not_found', value: envKey };
  }

  const targets = allSessionTargets();
  const live = (
    await Promise.all(
      targets.map(async (target) => {
        const key = sessionKeyOf(target.session);
        const endpoint = target.session.controllerEndpoint || getIpcEndpointPath(key);
        return (await isControllerReachable(endpoint)) ? target : null;
      })
    )
  ).filter((target): target is Target => target !== null);

  if (live.length === 1) return { target: live[0] };
  if (live.length > 1) return { error: 'ambiguous', candidates: live };
  return { error: 'no_live_sessions' };
}

async function pingController(
  endpoint: string
): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    const response = await sendControllerRequest(
      endpoint,
      { id: `status-ping-${started}`, method: 'ping' },
      IPC_TIMEOUT_MS
    );
    return {
      reachable: response.type === 'success',
      latencyMs: response.type === 'success' ? Date.now() - started : null,
    };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

async function probeController(endpoint: string): Promise<ControllerProbe> {
  const [info, ping] = await Promise.all([
    fetchControllerInfo(endpoint).catch(() => null),
    pingController(endpoint),
  ]);
  return {
    info,
    reachable: ping.reachable || info !== null,
    latencyMs: ping.latencyMs,
  };
}

function createVersionCache(): VersionCache {
  const cache = new Map<string, Promise<string | null>>();
  return {
    get(executable, cwd, harness) {
      const key = `${harness}:${executable}:${cwd || ''}`;
      let promise = cache.get(key);
      if (!promise) {
        promise = detectHarnessVersion(executable, cwd);
        cache.set(key, promise);
      }
      return promise;
    },
  };
}

async function detectHarnessVersion(executable: string, cwd?: string): Promise<string | null> {
  try {
    const result = await execFileAsync(executable, ['--version'], {
      cwd,
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });
    const line = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    return line || null;
  } catch {
    return null;
  }
}

function runtimeFor(entry: SessionEntry, info: ControllerInfo | null): RuntimeIdentity | undefined {
  return info?.runtime || persistedRuntime(entry);
}

function classifyHealth(
  reachable: boolean,
  runtime: RuntimeIdentity | undefined,
  controllerProcess: ProcEntry | null
): RuntimeHealth {
  if (reachable && runtime) {
    if (runtime.runtimeState === 'running' && runtime.harnessPid === null) return 'inconsistent';
    return 'healthy';
  }
  if (reachable) return 'legacy-unknown';
  if (runtime && controllerProcess) return 'stale-socket';
  if (runtime) return 'stale-registry';
  return 'dead';
}

function activityFrom(info: ControllerInfo | null): StatusActivity {
  return {
    state: info?.state ?? null,
    reason: info?.activityReason ?? null,
    lastInputAt: info?.lastInputAt ?? null,
    lastOutputAt: info?.lastOutputAt ?? null,
    lastActivityAt: info?.lastActivityAt ?? null,
    quietForMs: info?.quietForMs ?? null,
  };
}

function processMetrics(
  runtime: RuntimeIdentity | undefined,
  entries: ProcEntry[]
): { controller: StatusProcess; harness: StatusHarnessProcess | null; bundle: number | null } {
  const controllerPid = runtime?.controllerPid ?? null;
  const controllerEntry =
    controllerPid === null ? null : entries.find((entry) => entry.pid === controllerPid) || null;
  const controller: StatusProcess = {
    pid: controllerPid,
    rssBytes: controllerEntry?.rssBytes ?? null,
  };

  if (runtime?.harnessPid === null || runtime?.harnessPid === undefined) {
    return {
      controller,
      harness: null,
      bundle: controller.rssBytes,
    };
  }

  const tree = collectProcessTree(runtime.harnessPid, entries);
  const harness: StatusHarnessProcess = {
    pid: runtime.harnessPid,
    rssBytes: tree.rootRssBytes,
    treeRssBytes: tree.treeRssBytes,
    treeProcessCount: tree.processCount,
  };
  return {
    controller,
    harness,
    bundle:
      controller.rssBytes !== null && tree.treeRssBytes !== null
        ? controller.rssBytes + tree.treeRssBytes
        : null,
  };
}

async function collectSnapshot(target: Target, versions: VersionCache): Promise<StatusSnapshot> {
  const entry = target.session;
  const key = sessionKeyOf(entry);
  const endpoint = entry.controllerEndpoint || getIpcEndpointPath(key);
  const [probe, config] = await Promise.all([
    probeController(endpoint),
    Promise.resolve().then(() => {
      try {
        return loadConfig();
      } catch {
        return null;
      }
    }),
  ]);
  const runtime = runtimeFor(entry, probe.info);
  const procEntries = process.platform === 'linux' ? listProcEntries() : [];
  const controllerProcess = runtime?.controllerPid
    ? procEntries.find((candidate) => candidate.pid === runtime.controllerPid) || null
    : null;
  const metrics = processMetrics(runtime, procEntries);
  const executable = config?.profiles[target.profile]?.executable || target.profile;
  const harness = detectHarness(executable);
  const harnessVersion = await versions.get(executable, entry.cwd, harness);
  const startedAt = probe.info?.startedAt ?? entry.startedAt;
  const runtimeState = runtime?.runtimeState || 'unknown';
  const activity = activityFrom(probe.info);
  const buffers = probe.info?.buffers;

  return {
    session: {
      key,
      profile: target.profile,
      harness,
      nativeSessionId: entry.profileSessionId || null,
      cwd: entry.cwd || null,
      state: runtimeState,
      activity,
      attachedClients: probe.info?.attached ?? buffers?.attachedClients ?? null,
      uptimeMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
    },
    runtime: {
      runtimeId: runtime?.runtimeId || null,
      controllerPid: runtime?.controllerPid ?? null,
      harnessPid: runtime?.harnessPid ?? null,
      runtimeState,
      health: classifyHealth(probe.reachable, runtime, controllerProcess),
      controllerReachable: probe.reachable,
      pingLatencyMs: probe.latencyMs,
    },
    processes: {
      airelay: metrics.controller,
      harness: metrics.harness,
      bundleRssBytes: metrics.bundle,
    },
    buffers: {
      rawRingBytes: buffers?.rawRingBytes ?? null,
      rawRingChunks: buffers?.rawRingChunks ?? null,
      outputBufferLines: buffers?.outputBufferLines ?? null,
      snapshotBufferLines: buffers?.snapshotBufferLines ?? null,
      attachedClients: buffers?.attachedClients ?? probe.info?.attached ?? null,
    },
    versions: {
      airelay: getAirelayVersion(),
      harness: { name: harness, version: harnessVersion },
    },
  };
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  let seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function renderStatus(snapshot: StatusSnapshot): string {
  const { session, runtime, processes, buffers, versions } = snapshot;
  const lines = [
    'Airelay status',
    '',
    'Session',
    `  key              ${session.key}`,
    `  profile          ${session.profile}`,
    `  harness          ${session.harness}`,
    `  native session   ${session.nativeSessionId || '-'}`,
    `  project          ${session.cwd || '-'}`,
    `  state            ${session.state}`,
    `  activity         ${session.activity.state || '-'}`,
    `  activity reason  ${session.activity.reason || '-'}`,
    `  last input       ${session.activity.lastInputAt ?? '-'}`,
    `  last output      ${session.activity.lastOutputAt ?? '-'}`,
    `  quiet for        ${session.activity.quietForMs ?? '-'} ms`,
    `  attached         ${session.attachedClients ?? '-'}`,
    `  uptime           ${formatDuration(session.uptimeMs)}`,
    '',
    'Processes',
    `  Airelay PID      ${processes.airelay.pid ?? '-'}`,
    `  Airelay RSS      ${formatBytes(processes.airelay.rssBytes)}`,
    '',
    `  Harness          ${session.harness}`,
    `  Harness PID      ${processes.harness?.pid ?? '-'}`,
    `  Harness root RSS ${formatBytes(processes.harness?.rssBytes ?? null)}`,
    `  Harness tree     ${formatBytes(processes.harness?.treeRssBytes ?? null)}`,
    `  Tree processes   ${processes.harness?.treeProcessCount ?? '-'}`,
    '',
    `  Bundle RSS       ${formatBytes(processes.bundleRssBytes)}`,
    '',
    'Runtime',
    `  runtime id       ${runtime.runtimeId || '-'}`,
    `  controller       ${runtime.health}`,
    `  delivery         ${session.activity.reason === 'prompt_delivery' ? 'pending' : '-'}`,
    '',
    'Buffers',
    `  raw ring         ${formatBytes(buffers.rawRingBytes)} / ${buffers.rawRingChunks ?? '-'} chunks`,
    `  output buffer    ${buffers.outputBufferLines ?? '-'} lines`,
    `  snapshot         ${buffers.snapshotBufferLines ?? '-'} lines`,
    '',
    'Versions',
    `  Airelay          v${versions.airelay}`,
    `  Harness          ${versions.harness.name} ${versions.harness.version || '-'}`,
  ];
  return lines.join('\n');
}

function printError(
  error: 'not_found' | 'no_live_sessions' | 'ambiguous',
  options: StatusOptions,
  value?: string,
  candidates?: Target[]
): number {
  const messages = {
    not_found: value ? `Session not found: ${value}` : 'Session not found.',
    no_live_sessions: 'No live Airelay sessions found.',
    ambiguous: 'Multiple live Airelay sessions found; specify a session key.',
  };
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          error,
          message: messages[error],
          ...(candidates
            ? {
                candidates: candidates.map((candidate) => ({
                  sessionKey: sessionKeyOf(candidate.session),
                  profile: candidate.profile,
                })),
              }
            : {}),
        },
        null,
        2
      )
    );
  } else {
    console.error(`Error: ${messages[error]}`);
    if (candidates) {
      for (const candidate of candidates) {
        console.error(`  ${sessionKeyOf(candidate.session)} (${candidate.profile})`);
      }
    }
  }
  return 1;
}

export function parseStatusInterval(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)(ms|s|m)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1000 : 60_000;
  const interval = amount * multiplier;
  return interval > 0 && Number.isSafeInteger(interval) ? interval : undefined;
}

export async function watchStatus(target: Target, options: StatusOptions): Promise<number> {
  const intervalMs = options.intervalMs || DEFAULT_WATCH_INTERVAL_MS;
  const versions = createVersionCache();
  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };
  process.once('SIGINT', stop);
  try {
    while (!stopped) {
      const snapshot = await collectSnapshot(target, versions);
      if (options.json || !process.stdout.isTTY) {
        console.log(JSON.stringify(snapshot));
      } else {
        process.stdout.write('\x1b[H\x1b[2J' + renderStatus(snapshot) + '\n');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    process.removeListener('SIGINT', stop);
  }
  return 0;
}

export async function statusCommand(
  sessionKey?: string,
  options: StatusOptions = {}
): Promise<number> {
  if (process.platform !== 'linux') {
    if (options.json) console.log(JSON.stringify({ error: 'unsupported_platform' }));
    else console.error('Error: airelay status process inspection is supported on Linux only.');
    return 1;
  }

  const resolvedInterval = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  if (!Number.isSafeInteger(resolvedInterval) || resolvedInterval <= 0) {
    if (options.json) {
      console.log(
        JSON.stringify({
          error: 'invalid_interval',
          message: 'Interval must be greater than zero.',
        })
      );
    } else {
      console.error('Error: Interval must be greater than zero.');
    }
    return 1;
  }

  const resolved = await resolveTarget(sessionKey);
  if ('error' in resolved) {
    return printError(resolved.error, options, resolved.value, resolved.candidates);
  }
  if (options.watch)
    return watchStatus(resolved.target, { ...options, intervalMs: resolvedInterval });

  const snapshot = await collectSnapshot(resolved.target, createVersionCache());
  if (options.json) console.log(JSON.stringify(snapshot, null, 2));
  else console.log(renderStatus(snapshot));
  return 0;
}
