import { runCommand } from './run';

export interface StartOptions {
  key?: string;
  invocationCwd?: string;
  launchArgv?: string[];
}

export async function startCommand(
  profile: string,
  extraArgs: string[],
  options?: StartOptions
): Promise<void> {
  const exitCode = await runCommand(profile, extraArgs, {
    usePty: true,
    sessionKey: options?.key,
    recordLaunch: true,
    invocationCwd: options?.invocationCwd,
    launchArgv: options?.launchArgv,
  });
  process.exit(exitCode);
}
