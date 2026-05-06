import { loadConfig, getConfigPath } from '../config/load';
import { Profile } from '../config/schema';
import { resolvePath, isPathLike } from '../config/paths';
import { buildEnv } from '../runtime/env';
import { spawnAndWait, SpawnOptions } from '../runtime/spawn';
import { SessionController } from '../controller';
import { IpcError, IpcErrorCodes } from '../types/controller';
import { addSession, deleteSession, updateSessionPid } from './sessions';
import { getAirelayVersion, CONTROLLER_PROTOCOL_VERSION } from '../utils/version';
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
  ptyWrite: { current: ((data: string) => void) | null }
) {
  const controller = new SessionController(sessionKey);

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
        enter?: string | boolean;
        submitDelayMs?: number;
      };
      const text = params.text || '';
      ptyWrite.current(text);
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
        ptyWrite.current(byte);
      }
      return { delivered: true, sessionKey };
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
  }
): Promise<number> {
  const { profile, cwd, env, args } = buildProfileEnv(profileName, extraArgs);

  const sessionKey = options?.sessionKey || generateSessionKey(profileName);
  // Generate a distinct internal runtime id (opaque, not the sessionKey)
  const runtimeId = `runtime_${sessionKey.slice(-12)}_${Date.now().toString(36)}`;
  const ptyWriteRef: { current: ((data: string) => void) | null } = { current: null };
  const controller = setupController(sessionKey, ptyWriteRef);

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

  const usePty = options?.usePty === true;

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
      // Record runtime PID for liveness pruning
      updateSessionPid(sessionKey, pty.pid);
    };
  }

  // Feed PTY output to the controller's ring buffer for session-find / ui_hint
  spawnOpts.onOutput = (chunk: string) => {
    controller.feedOutput(chunk);
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
