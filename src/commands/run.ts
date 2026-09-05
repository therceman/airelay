import { loadConfig, getConfigPath } from '../config/load';
import { Profile } from '../config/schema';
import { resolvePath, isPathLike } from '../config/paths';
import { buildEnv } from '../runtime/env';
import { spawnAndWait, SpawnOptions } from '../runtime/spawn';
import { SessionController } from '../controller';
import { IpcError, IpcErrorCodes, IpcErrorReasons } from '../types/controller';
import { addSession, deleteSession, updateSessionPid } from './sessions';
import { recordLaunchHistory } from './history';
import { getAirelayVersion, CONTROLLER_PROTOCOL_VERSION } from '../utils/version';
import {
  detectHarness,
  getHarnessCapabilities,
  getHarnessSelfUpdateOverrides,
} from '../utils/harness';
import { CapacityContinuationWatcher } from '../runtime/capacity-watcher';
import { InputSubmitWatcher } from '../runtime/input-submit-watcher';
import { DeliveryTracker } from '../runtime/delivery';
import { InterruptController, InterruptResult } from '../runtime/interrupt';
import {
  addDetachedEntry,
  removeDetachedEntry,
  updateDetachedEntry,
} from '../runtime/detached-registry';
import fs from 'fs';
import { ensureCodexProfileStandalone } from '../utils/codex-standalone';
import { isInputTextVisible } from '../runtime/input-submit-watcher';
import { parseDurationMs } from '../utils/duration';

function generateSessionKey(profileName: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${profileName}_${suffix}`;
}

/** Info handed to `onDetachedReady` once a detached runtime is fully started. */
export interface DetachedReadyInfo {
  sessionKey: string;
  runtimeId: string;
  runtimePid: number;
  agentPid: number;
  controllerEndpoint: string;
  profile: string;
  cwd: string;
  startedAt: number;
}

/** Extract a harness resume session id from extra args (e.g. resume <id> or -s <id>). */
export function detectResumeSessionId(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === 'resume' || args[i] === '-s') && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}

export interface RunStartInfo {
  sessionKey: string;
  controllerEndpoint: string;
}

export function buildProfileEnv(
  profileName: string,
  extraArgs: string[],
  cwdOverride?: string,
  harnessSelfUpdateOverride?: boolean
): {
  profile: Profile;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  hibernateAfterMs: number;
} {
  const config = loadConfig();
  const configPath = getConfigPath();

  const profile = config.profiles[profileName] as Profile | undefined;
  if (!profile) {
    const availableProfiles = Object.keys(config.profiles).join(', ');
    throw new Error(
      `Profile not found: ${profileName}\nAvailable profiles: ${availableProfiles || 'none'}\nRun 'airelay create <name>' to create a new profile.`
    );
  }

  const cwd = cwdOverride
    ? resolvePath(cwdOverride)
    : profile.cwd
      ? resolvePath(profile.cwd)
      : process.cwd();
  ensureDirectories(profile, cwd);
  const env = buildEnv(profile, configPath);
  const harness = detectHarness(profile.executable);
  if (harness === 'codex' && env.CODEX_HOME) {
    ensureCodexProfileStandalone(env.CODEX_HOME);
  }

  const selfUpdateOverrides = getHarnessSelfUpdateOverrides(
    harness,
    harnessSelfUpdateOverride ?? config.settings.harnessSelfUpdate
  );
  Object.assign(env, selfUpdateOverrides.env);

  return {
    profile,
    cwd,
    env,
    args: [...(profile.args || []), ...selfUpdateOverrides.args, ...extraArgs],
    hibernateAfterMs: parseDurationMs(config.settings.hibernateAfter) ?? -1,
  };
}

function setupController(
  sessionKey: string,
  ptyWrite: { current: ((data: string) => void) | null },
  ptyResize: { current: ((cols: number, rows: number) => void) | null },
  deliveryTracker: DeliveryTracker,
  onInputInjected?: (deliveryId: string, text: string, submitValue: string) => void,
  onInterrupt?: () => Promise<InterruptResult>,
  onWakeRequested?: () => Promise<void>,
  onActivity?: () => void
) {
  const controller = new SessionController(sessionKey);
  controller.setDeliveryStatusProvider(() => deliveryTracker.get());

  controller.onRequest(async (request) => {
    if (request.method === 'session.input.raw') {
      if (!ptyWrite.current) {
        if (onWakeRequested) {
          await onWakeRequested();
          return { delivered: false, waking: true, raw: true };
        }
        throw new IpcError(
          IpcErrorCodes.INTERNAL_ERROR,
          'Raw input unavailable: the PTY for this session is not ready.',
          IpcErrorReasons.CONTROLLER_UNAVAILABLE
        );
      }
      const data = (request.params as { data?: string })?.data ?? '';
      onActivity?.();
      ptyWrite.current(data);
      return { delivered: true, raw: true };
    }
    if (request.method === 'session.resize') {
      const params = request.params as { cols?: number; rows?: number };
      const cols = typeof params.cols === 'number' ? params.cols : 0;
      const rows = typeof params.rows === 'number' ? params.rows : 0;
      if (cols > 0 && rows > 0) {
        controller.resize(cols, rows);
        ptyResize.current?.(cols, rows);
      }
      return { resized: true };
    }
    if (request.method === 'session.input') {
      if (!ptyWrite.current) {
        if (onWakeRequested) {
          await onWakeRequested();
        }
      }
      if (!ptyWrite.current) {
        throw new IpcError(
          IpcErrorCodes.INTERNAL_ERROR,
          'Prompt injection unavailable: this session is not in a promptable mode. Use "airelay start <profile>" for prompt-capable sessions.',
          IpcErrorReasons.NOT_PROMPTABLE
        );
      }

      const params = request.params as {
        text?: string;
        deliveryId?: string;
        enter?: string | boolean;
        submitDelayMs?: number;
      };
      const text = params.text || '';
      const deliveryId =
        typeof params.deliveryId === 'string' && params.deliveryId.trim()
          ? params.deliveryId
          : `legacy_${request.id}_${Date.now()}`;
      const begin = deliveryTracker.begin(deliveryId);
      if (begin.duplicate) {
        return { delivered: true, duplicate: true, sessionKey, delivery: begin.status };
      }

      try {
        onActivity?.();
        ptyWrite.current(text);
      } catch (error) {
        deliveryTracker.markFailure(deliveryId, controller.getLiveViewportLines());
        throw error;
      }
      const submit = params.enter;
      if (submit !== false && submit !== undefined) {
        // Small delay before submit to let the app process text input first.
        // Without this, the submit byte can land in the wrong buffer position
        // and produce a newline instead of submit (especially under tmux).
        const delayMs =
          typeof params.submitDelayMs === 'number' && params.submitDelayMs > 0
            ? Math.floor(params.submitDelayMs)
            : 0;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const byte = typeof submit === 'string' ? submit : '\r';
        try {
          ptyWrite.current(byte);
        } catch (error) {
          deliveryTracker.markFailure(deliveryId, controller.getLiveViewportLines());
          throw error;
        }
        deliveryTracker.markSubmitSent(deliveryId);
        onInputInjected?.(deliveryId, text, byte);
      }
      return {
        delivered: true,
        duplicate: false,
        sessionKey,
        deliveryId,
        delivery: deliveryTracker.get(deliveryId),
      };
    }
    if (request.method === 'session.interrupt') {
      return onInterrupt ? onInterrupt() : { outcome: 'unsupported', requested: false };
    }
    return { handled: false };
  });

  return controller;
}

export async function runCommand(
  profileName: string,
  extraArgs: string[],
  options?: {
    usePty?: boolean;
    cwd?: string;
    sessionKey?: string;
    profileSessionId?: string;
    profileArgs?: string[];
    onSessionStart?: (info: RunStartInfo) => void;
    recordLaunch?: boolean;
    invocationCwd?: string;
    launchArgv?: string[];
    detached?: boolean;
    harnessSelfUpdate?: boolean;
    onDetachedReady?: (info: DetachedReadyInfo) => void;
  }
): Promise<number> {
  const { profile, cwd, env, args, hibernateAfterMs } = buildProfileEnv(
    profileName,
    extraArgs,
    options?.cwd,
    options?.harnessSelfUpdate
  );

  const sessionKey = options?.sessionKey || generateSessionKey(profileName);
  // Generate a distinct internal runtime id (opaque, not the sessionKey)
  const runtimeId = `runtime_${sessionKey.slice(-12)}_${Date.now().toString(36)}`;
  const ptyWriteRef: { current: ((data: string) => void) | null } = { current: null };
  const ptyResizeRef: { current: ((cols: number, rows: number) => void) | null } = {
    current: null,
  };
  const ptyKillRef: { current: ((signal?: string) => void) | null } = { current: null };
  const usePty = options?.usePty === true;
  const detectedProfileSessionId = options?.profileSessionId || detectResumeSessionId(args);
  const hibernationEnabled =
    usePty &&
    hibernateAfterMs > 0 &&
    !!detectedProfileSessionId &&
    (options?.detached === true || process.stdin.isTTY === true);
  const harnessCapabilities = getHarnessCapabilities(detectHarness(profile.executable));
  const deliveryTracker = new DeliveryTracker();
  let hibernated = false;
  let hibernateRequested = false;
  let wakeRequested = false;
  let wakeSignal: Promise<void> | null = null;
  let wakeSignalResolve: (() => void) | null = null;
  let wakeReady: Promise<void> | null = null;
  let wakeReadyResolve: (() => void) | null = null;
  let wakeReadyReject: ((error: Error) => void) | null = null;
  let foregroundWakeCleanup: (() => void) | null = null;
  let hibernateTimer: ReturnType<typeof setTimeout> | null = null;
  let resetHibernateTimer: () => void = () => undefined;

  const prepareWake = (): void => {
    wakeRequested = false;
    wakeSignal = new Promise<void>((resolve) => {
      wakeSignalResolve = resolve;
    });
    wakeReady = new Promise<void>((resolve, reject) => {
      wakeReadyResolve = resolve;
      wakeReadyReject = reject;
    });
  };

  const requestWake = async (): Promise<void> => {
    if (!hibernated) return;
    wakeRequested = true;
    wakeSignalResolve?.();
    if (wakeReady) await wakeReady;
  };

  const waitForWake = async (): Promise<void> => {
    if (!wakeRequested && wakeSignal) {
      if (!options?.detached && process.stdin.isTTY) {
        const onWakeKey = (chunk: Buffer): void => {
          if (chunk.length > 0) void requestWake();
        };
        const stdinWasFlowing = process.stdin.readableFlowing;
        process.stdin.setRawMode?.(true);
        process.stdin.on('data', onWakeKey);
        process.stdin.resume();
        foregroundWakeCleanup = () => {
          process.stdin.removeListener('data', onWakeKey);
          process.stdin.setRawMode?.(false);
          if (stdinWasFlowing === false) process.stdin.pause();
        };
      }
      await wakeSignal;
    }
    foregroundWakeCleanup?.();
    foregroundWakeCleanup = null;
  };

  let currentDeliveryId: string | undefined;
  let turnGeneration = 0;
  let activeTurnGeneration: number | undefined;
  let workingSeen = false;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  let controllerRef: SessionController | null = null;
  let interruptController: InterruptController | null = null;
  const continuation = harnessCapabilities.capacityContinuation;
  const capacityWatcher = continuation
    ? new CapacityContinuationWatcher({
        continuationText: continuation.text,
        capacityMessage: continuation.message,
        quietPeriodMs: continuation.quietPeriodMs,
        submitDelayMs: continuation.submitDelayMs,
        submitValue: harnessCapabilities.submitValue,
        write: () => ptyWriteRef.current,
        maxAttempts: continuation.maxAttempts,
        retryDelaysMs: continuation.retryDelaysMs,
        onDetected: () => {
          if (currentDeliveryId) {
            deliveryTracker.markCapacity(
              currentDeliveryId,
              controllerRef?.getLiveViewportLines() || []
            );
          }
        },
        onExhausted: () => {
          if (currentDeliveryId) {
            deliveryTracker.markFailure(
              currentDeliveryId,
              controllerRef?.getLiveViewportLines() || []
            );
          }
        },
      })
    : null;
  const inputRetry = harnessCapabilities.inputSubmitRetry;
  const inputWatcher =
    usePty && inputRetry
      ? new InputSubmitWatcher({
          ...inputRetry,
          write: () => ptyWriteRef.current,
          isSubmissionAcknowledged: () => workingSeen,
          onAcknowledged: (deliveryId) => {
            if (deliveryId) deliveryTracker.markSubmitAcknowledged(deliveryId);
          },
          onRetry: (deliveryId) => {
            if (deliveryId) deliveryTracker.markSubmitRetry(deliveryId);
          },
          onExhausted: (deliveryId) => {
            if (deliveryId) {
              deliveryTracker.markFailure(deliveryId, controllerRef?.getLiveViewportLines() || []);
            }
          },
          isInputVisible: (text) => {
            return isInputTextVisible(
              text,
              controllerRef?.getLiveViewportLines() || [],
              inputRetry.pendingInputMarkers
            );
          },
        })
      : null;
  const controller = setupController(
    sessionKey,
    ptyWriteRef,
    ptyResizeRef,
    deliveryTracker,
    (deliveryId, text, submitValue) => {
      turnGeneration += 1;
      activeTurnGeneration = turnGeneration;
      currentDeliveryId = deliveryId;
      workingSeen = false;
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      inputWatcher?.track(text, submitValue, deliveryId);
      resetHibernateTimer();
    },
    () =>
      interruptController?.request() ||
      Promise.resolve({ outcome: 'unsupported', requested: false } as InterruptResult),
    requestWake,
    () => resetHibernateTimer()
  );
  controllerRef = controller;

  if (options?.detached === true) {
    controller.setOnAttachedChange((count) => {
      updateDetachedEntry(runtimeId, { attachedClients: count });
    });
  }

  const interrupt = harnessCapabilities.interrupt;
  interruptController = new InterruptController({
    value: interrupt?.value,
    ackTimeoutMs: interrupt?.ackTimeoutMs || 0,
    pollIntervalMs: interrupt?.pollIntervalMs || 50,
    write: () => ptyWriteRef.current,
    getActiveTurnId: () => activeTurnGeneration,
    isWorking: (turnId) => {
      if (activeTurnGeneration !== turnId || !currentDeliveryId || !interrupt) return false;
      return controller
        .getLiveViewportLines()
        .join(' ')
        .includes(harnessCapabilities.uiWorkingHint);
    },
    onAcknowledged: (turnId) => {
      if (activeTurnGeneration !== turnId) return;
      if (currentDeliveryId) {
        deliveryTracker.markInterrupted(currentDeliveryId, controller.getLiveViewportLines());
      }
      inputWatcher?.cancel();
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      activeTurnGeneration = undefined;
      currentDeliveryId = undefined;
      workingSeen = false;
      resetHibernateTimer();
    },
  });

  const preview = (): string[] => controller.getLiveViewportLines();
  const harnessLabel = detectHarness(profile.executable);
  const isHarnessWorking = (): boolean => {
    const hint = harnessCapabilities.uiWorkingHint;
    return !!hint && preview().join(' ').includes(hint);
  };
  const isAgentIdle = (): boolean =>
    activeTurnGeneration === undefined && !inputWatcher?.hasPending() && !isHarnessWorking();
  controller.setActivityStateProvider(() => (isAgentIdle() ? 'idle' : 'busy'));
  const canHibernate = (): boolean =>
    hibernationEnabled &&
    !hibernated &&
    !hibernateRequested &&
    isAgentIdle() &&
    controller.getAttachedClientCount() === 0;
  const showHibernatedScreen = (): void => {
    const label = harnessLabel === 'unknown' ? profile.executable : harnessLabel;
    const screen =
      `\x1b[2J\x1b[HAgent hibernated [${label}]\r\n` +
      `Session: ${detectedProfileSessionId}\r\n` +
      `Project: ${cwd}\r\n\r\n` +
      'Press any key to wake\r\n';
    // Keep the controller's viewport/attach stream truthful while the child
    // process is gone. This also gives detached clients a useful idle screen.
    controller.feedOutput(screen);
    if (!process.stdout.isTTY || options?.detached === true) return;
    try {
      process.stdout.write(screen);
    } catch {
      // The terminal may have closed while the child was shutting down.
    }
  };
  const requestHibernate = (): void => {
    if (!canHibernate()) return;
    hibernateRequested = true;
    hibernated = true;
    prepareWake();
    const killPty = ptyKillRef.current;
    ptyWriteRef.current = null;
    ptyResizeRef.current = null;
    ptyKillRef.current = null;
    killPty?.(process.platform === 'win32' ? undefined : 'SIGTERM');
  };
  resetHibernateTimer = (): void => {
    if (hibernateTimer) clearTimeout(hibernateTimer);
    hibernateTimer = null;
    if (!hibernationEnabled || hibernated || hibernateAfterMs <= 0) return;
    hibernateTimer = setTimeout(() => {
      hibernateTimer = null;
      if (canHibernate()) {
        requestHibernate();
      } else {
        resetHibernateTimer();
      }
    }, hibernateAfterMs);
  };
  const observeDeliveryState = (): void => {
    if (!currentDeliveryId) return;
    const status = deliveryTracker.get(currentDeliveryId);
    if (!status || status.state === 'terminal_delivery_failure') return;

    const lines = preview();
    deliveryTracker.updatePreview(currentDeliveryId, lines);
    const rendered = lines.join(' ');
    const isWorking =
      !!harnessCapabilities.uiWorkingHint && rendered.includes(harnessCapabilities.uiWorkingHint);

    if (isWorking) {
      workingSeen = true;
      deliveryTracker.markSubmitAcknowledged(currentDeliveryId);
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      deliveryTracker.markWorking(currentDeliveryId, lines);
      return;
    }

    if (workingSeen && status.submitAcknowledgedAt && !inputWatcher?.hasPending()) {
      if (!completionTimer) {
        completionTimer = setTimeout(() => {
          completionTimer = null;
          const current = currentDeliveryId ? deliveryTracker.get(currentDeliveryId) : undefined;
          if (!current || !workingSeen || inputWatcher?.hasPending()) return;
          const generation = activeTurnGeneration;
          if (generation !== undefined && interruptController?.isPending(generation) === true) {
            // An interrupt request is still resolving against this exact captured
            // generation. Keep the target bound until it resolves so the
            // interrupt can positively acknowledge the same-generation stop
            // instead of racing natural completion. The interrupt is bounded by
            // ackTimeoutMs, so this short deferral cannot spin forever.
            completionTimer = setTimeout(() => {
              completionTimer = null;
              observeDeliveryState();
            }, 100);
            return;
          }
          deliveryTracker.markResponseReceived(current.deliveryId, preview());
          activeTurnGeneration = undefined;
          currentDeliveryId = undefined;
          workingSeen = false;
          resetHibernateTimer();
        }, 500);
      }
    }
  };

  let controllerStarted = false;
  try {
    await controller.start();
    controllerStarted = true;
  } catch {
    // Controller start failure is non-fatal; session runs without IPC
  }

  if (controllerStarted && options?.onSessionStart) {
    options.onSessionStart({ sessionKey, controllerEndpoint: controller.endpointPath });
  }

  if (options?.recordLaunch) {
    const launchArgv = options.launchArgv || [
      'start',
      profileName,
      ...(sessionKey ? ['--key', sessionKey] : []),
      ...(extraArgs.length > 0 ? ['--', ...extraArgs] : []),
    ];
    recordLaunchHistory({
      profile: profileName,
      sessionKey,
      invocationCwd: options.invocationCwd || process.cwd(),
      argv: launchArgv,
    });
  }

  addSession(
    profileName,
    runtimeId,
    cwd,
    sessionKey,
    controller.endpointPath,
    undefined,
    getAirelayVersion(),
    CONTROLLER_PROTOCOL_VERSION,
    Date.now(),
    detectedProfileSessionId,
    extraArgs.length > 0 ? extraArgs : undefined
  );

  // Inject session metadata into child process environment
  env.AIRELAY_SESSION_KEY = sessionKey;
  env.AIRELAY_PROFILE = profileName;
  env.AIRELAY_SESSION_ID = sessionKey;
  env.AIRELAY_CWD = cwd;
  env.AIRELAY_VERSION = getAirelayVersion();
  env.AIRELAY_CONTROLLER_PROTOCOL_VERSION = String(CONTROLLER_PROTOCOL_VERSION);

  const spawnOpts: SpawnOptions = {
    executable: profile.executable,
    args,
    cwd,
    env,
    profile: profileName,
    trackPID: true,
    usePty,
    detached: options?.detached === true,
  };

  if (usePty) {
    spawnOpts.onPtyReady = (pty) => {
      ptyWriteRef.current = pty.write;
      ptyResizeRef.current = (cols, rows) => pty.resize(cols, rows);
      ptyKillRef.current = pty.kill;
      const cols = process.stdout.isTTY ? process.stdout.columns : 80;
      const rows = process.stdout.isTTY ? process.stdout.rows : 24;
      controller.resize(cols, rows);
      // Record the PID used for liveness pruning. For a detached runtime the
      // session is serviced by the runtime/controller process (this process),
      // so liveness must track that PID — not the harness agent PID — to keep
      // the session consistent with the detached registry and avoid pruning a
      // session for a still-registered, still-alive runtime.
      updateSessionPid(sessionKey, options?.detached === true ? process.pid : pty.pid);

      if (options?.detached === true) {
        const startedAt = Date.now();
        const info: DetachedReadyInfo = {
          sessionKey,
          runtimeId,
          runtimePid: process.pid,
          agentPid: pty.pid,
          controllerEndpoint: controller.endpointPath,
          profile: profileName,
          cwd,
          startedAt,
        };
        addDetachedEntry({
          runtimeId,
          sessionKey,
          profile: profileName,
          cwd,
          runtimePid: process.pid,
          agentPid: pty.pid,
          controllerEndpoint: controller.endpointPath,
          startedAt,
          attachedClients: controller.getAttachedClientCount(),
        });
        options.onDetachedReady?.(info);
      }
      if (hibernated) {
        hibernated = false;
        wakeReadyResolve?.();
        wakeReadyResolve = null;
        wakeReadyReject = null;
        wakeReady = null;
      }
      resetHibernateTimer();
    };
  }

  // Feed PTY output to the controller's ring buffer for session-find / ui_hint
  spawnOpts.onOutput = (chunk: string) => {
    controller.feedOutput(chunk);
    capacityWatcher?.observe(chunk);
    inputWatcher?.observeOutput(chunk);
    observeDeliveryState();
    if (activeTurnGeneration !== undefined) resetHibernateTimer();
  };
  spawnOpts.onInput = () => resetHibernateTimer();

  try {
    let keepRunning = true;
    let exitCode = 0;
    while (keepRunning) {
      exitCode = await spawnAndWait(spawnOpts);
      ptyWriteRef.current = null;
      ptyResizeRef.current = null;
      ptyKillRef.current = null;

      if (!hibernateRequested) {
        keepRunning = false;
        continue;
      }

      hibernateRequested = false;
      showHibernatedScreen();
      await waitForWake();
      // Reuse the original resumable launch arguments. The harness restores
      // its persisted conversation from the same native session ID.
    }
    return exitCode;
  } catch (e: unknown) {
    if ((e as Error).message?.includes('Failed to spawn')) {
      console.error('\nError: Failed to start harness.');
      console.error('If your terminal appears corrupted or unresponsive:');
      console.error('  1. Try resizing the terminal window');
      console.error('  2. Run `reset` command');
      console.error('  3. Restart the terminal');
      console.error('\nThis can happen when TUI apps leave the terminal in an inconsistent state.');
    }
    throw e;
  } finally {
    if (hibernateTimer) clearTimeout(hibernateTimer);
    const cleanupWake = foregroundWakeCleanup as (() => void) | null;
    foregroundWakeCleanup = null;
    cleanupWake?.();
    const rejectWake = wakeReadyReject as ((error: Error) => void) | null;
    wakeReadyReject = null;
    rejectWake?.(new Error('Session stopped before wake-up completed.'));
    if (completionTimer) clearTimeout(completionTimer);
    capacityWatcher?.dispose();
    inputWatcher?.dispose();
    await controller.stop();
    deleteSession(profileName, runtimeId);
    if (options?.detached === true) {
      removeDetachedEntry(runtimeId);
    }
  }
}

function ensureDirectories(profile: Profile, cwd?: string): void {
  const dirs: string[] = [];

  if (cwd && fs.existsSync(cwd)) {
    dirs.push(cwd);
  }

  if (profile.createDirs) {
    for (const d of profile.createDirs) {
      dirs.push(resolvePath(d));
    }
  }

  if (profile.env) {
    for (const [key, value] of Object.entries(profile.env)) {
      if (isPathLike(key)) {
        dirs.push(resolvePath(value));
      }
    }
  }

  for (const dir of dirs) {
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
