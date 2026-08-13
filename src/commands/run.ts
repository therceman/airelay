import { loadConfig, getConfigPath } from '../config/load';
import { Profile } from '../config/schema';
import { resolvePath, isPathLike } from '../config/paths';
import { buildEnv } from '../runtime/env';
import { spawnAndWait, SpawnOptions } from '../runtime/spawn';
import { SessionController } from '../controller';
import { IpcError, IpcErrorCodes } from '../types/controller';
import { addSession, deleteSession, updateSessionPid } from './sessions';
import { recordLaunchHistory } from './history';
import { getAirelayVersion, CONTROLLER_PROTOCOL_VERSION } from '../utils/version';
import { detectHarness, getHarnessCapabilities } from '../utils/harness';
import { CapacityContinuationWatcher } from '../runtime/capacity-watcher';
import { InputSubmitWatcher } from '../runtime/input-submit-watcher';
import { DeliveryTracker } from '../runtime/delivery';
import fs from 'fs';

function generateSessionKey(profileName: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${profileName}_${suffix}`;
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

function buildProfileEnv(
  profileName: string,
  extraArgs: string[]
): {
  profile: Profile;
  cwd: string;
  env: Record<string, string>;
  args: string[];
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

  const cwd = profile.cwd ? resolvePath(profile.cwd) : process.cwd();
  ensureDirectories(profile, cwd);

  return {
    profile,
    cwd,
    env: buildEnv(profile, configPath),
    args: [...(profile.args || []), ...extraArgs],
  };
}

function setupController(
  sessionKey: string,
  ptyWrite: { current: ((data: string) => void) | null },
  deliveryTracker: DeliveryTracker,
  onInputInjected?: (deliveryId: string, text: string, submitValue: string) => void
) {
  const controller = new SessionController(sessionKey);
  controller.setDeliveryStatusProvider(() => deliveryTracker.get());

  controller.onRequest(async (request) => {
    if (request.method === 'session.input') {
      if (!ptyWrite.current) {
        throw new IpcError(
          IpcErrorCodes.INTERNAL_ERROR,
          'Prompt injection unavailable: this session is not in a promptable mode. Use "airelay start <profile>" for prompt-capable sessions.'
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
    return { handled: false };
  });

  return controller;
}

export async function runCommand(
  profileName: string,
  extraArgs: string[],
  options?: {
    usePty?: boolean;
    sessionKey?: string;
    profileSessionId?: string;
    profileArgs?: string[];
    onSessionStart?: (info: RunStartInfo) => void;
    recordLaunch?: boolean;
    invocationCwd?: string;
    launchArgv?: string[];
  }
): Promise<number> {
  const { profile, cwd, env, args } = buildProfileEnv(profileName, extraArgs);

  const sessionKey = options?.sessionKey || generateSessionKey(profileName);
  // Generate a distinct internal runtime id (opaque, not the sessionKey)
  const runtimeId = `runtime_${sessionKey.slice(-12)}_${Date.now().toString(36)}`;
  const ptyWriteRef: { current: ((data: string) => void) | null } = { current: null };
  const usePty = options?.usePty === true;
  const harnessCapabilities = getHarnessCapabilities(detectHarness(profile.executable));
  const deliveryTracker = new DeliveryTracker();
  let currentDeliveryId: string | undefined;
  let workingSeen = false;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  let controllerRef: SessionController | null = null;
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
            const normalizedText = text.replace(/\s+/g, ' ').trim();
            const viewport = controllerRef
              ?.getLiveViewportLines()
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            return !!normalizedText && !!viewport?.includes(normalizedText);
          },
        })
      : null;
  const controller = setupController(
    sessionKey,
    ptyWriteRef,
    deliveryTracker,
    (deliveryId, text, submitValue) => {
      currentDeliveryId = deliveryId;
      workingSeen = false;
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      inputWatcher?.track(text, submitValue, deliveryId);
    }
  );
  controllerRef = controller;

  const preview = (): string[] => controller.getLiveViewportLines();
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
          if (current && workingSeen && !inputWatcher?.hasPending()) {
            deliveryTracker.markResponseReceived(current.deliveryId, preview());
            currentDeliveryId = undefined;
            workingSeen = false;
          }
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

  // Derive profileSessionId from extraArgs (resume <id> or -s <id>)
  const detectedProfileSessionId = options?.profileSessionId || detectResumeSessionId(extraArgs);

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
  };

  if (usePty) {
    spawnOpts.onPtyReady = (pty) => {
      ptyWriteRef.current = pty.write;
      const cols = process.stdout.isTTY ? process.stdout.columns : 80;
      const rows = process.stdout.isTTY ? process.stdout.rows : 24;
      controller.resize(cols, rows);
      // Record runtime PID for liveness pruning
      updateSessionPid(sessionKey, pty.pid);
    };
  }

  // Feed PTY output to the controller's ring buffer for session-find / ui_hint
  spawnOpts.onOutput = (chunk: string) => {
    controller.feedOutput(chunk);
    capacityWatcher?.observe(chunk);
    inputWatcher?.observeOutput(chunk);
    observeDeliveryState();
  };

  try {
    const exitCode = await spawnAndWait(spawnOpts);

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
    if (completionTimer) clearTimeout(completionTimer);
    capacityWatcher?.dispose();
    inputWatcher?.dispose();
    await controller.stop();
    deleteSession(profileName, runtimeId);
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
