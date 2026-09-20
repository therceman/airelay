import { runCommand } from './run';
import { startDetachedCommand } from './detached';

export interface StartOptions {
  key?: string;
  detached?: boolean;
  bypass?: boolean;
  harnessSelfUpdate?: boolean;
  invocationCwd?: string;
  launchArgv?: string[];
}

export async function startCommand(
  profile: string,
  extraArgs: string[],
  options?: StartOptions
): Promise<void> {
  if (options?.detached === true) {
    const exitCode = await startDetachedCommand(profile, extraArgs, {
      key: options.key,
      bypass: options.bypass,
      harnessSelfUpdate: options.harnessSelfUpdate,
      invocationCwd: options.invocationCwd,
    });
    process.exit(exitCode);
    return;
  }

  const exitCode = await runCommand(profile, extraArgs, {
    usePty: true,
    sessionKey: options?.key,
    bypass: options?.bypass,
    harnessSelfUpdate: options?.harnessSelfUpdate,
    recordLaunch: true,
    invocationCwd: options?.invocationCwd,
    launchArgv: options?.launchArgv,
  });
  process.exit(exitCode);
  return;
}
