import { loadConfig, getConfigPath } from '../config/load';
import { provisionWorkspace, selectorParts, workspaceRoot } from '../workspace/provision';
import {
  listWorkspaces,
  resolveSessionWorkspace,
  verifySessionWorkspace,
} from '../workspace/binding';
import { buildEnv } from '../runtime/env';
import { resolveExecutable } from '../runtime/resolveExecutable';
import {
  validateWorkspaceProfile,
  validateWorkspaceArgs,
  verifyNativeWorkspace,
} from '../workspace/verify';

export function workspaceCommand(
  action: string | undefined,
  args: string[],
  flags: Record<string, string | boolean>
): number {
  if (!action || action === 'help') {
    console.log(
      [
        'airelay workspace provision <project>.<agent> [--source <repo>] [--dry-run]',
        'airelay workspace inspect <project>.<agent> [--json]',
        'airelay workspace verify <project>.<agent> [--profile <profile>] [--json]',
        'airelay workspace list [--json]',
        'Launch: airelay start <profile> --key <session-key> --workspace <project>.<agent>',
        'Directory: <settings.workspaceRoot>/<project>/agents/<agent> (fresh root: ~/.airelay/workspaces).',
        'Instructions and Skills are agent/user-owned. No roles or profiles are generated. Managed native verification currently supports Devin; zero MCP is required.',
      ].join('\n')
    );
    return 0;
  }
  if (
    !['provision', 'inspect', 'verify', 'list'].includes(action) ||
    args.length !== (action === 'list' ? 0 : 1)
  )
    throw new Error(
      'Usage: airelay workspace <provision|inspect|verify> <project>.<agent>; see airelay workspace help.'
    );
  const allowed = new Set([
    'json',
    'j',
    ...(action === 'verify' ? ['profile'] : []),
    ...(action === 'provision' ? ['source', 'dry-run', 'n'] : []),
  ]);
  for (const [name, flag] of Object.entries(flags)) {
    if (!allowed.has(name))
      throw new Error(`Unknown workspace option --${name}; see airelay workspace help.`);
    if (['json', 'j', 'dry-run', 'n'].includes(name) && flag !== true)
      throw new Error(`--${name} does not take a value.`);
  }
  const value = (name: string): string | undefined => {
    if (flags[name] === undefined) return undefined;
    if (typeof flags[name] !== 'string') throw new Error(`--${name} requires a value.`);
    return flags[name] as string;
  };
  const config = loadConfig(),
    root = config.settings.workspaceRoot;
  let result: unknown;
  if (action === 'list') result = { root: workspaceRoot(root), workspaces: listWorkspaces(root) };
  else {
    const selector = args[0],
      [project, agent] = selectorParts(selector);
    if (action === 'provision')
      result = {
        selector,
        ...provisionWorkspace({
          project,
          agent,
          root,
          source: value('source'),
          dryRun: flags['dry-run'] === true || flags.n === true,
        }),
      };
    else {
      const workspace = resolveSessionWorkspace(selector, root);
      if (action === 'verify') {
        const profileName = value('profile') || 'devin',
          profile = config.profiles[profileName];
        if (!profile) throw new Error(`Profile not found: ${profileName}; run airelay list.`);
        validateWorkspaceProfile(profile);
        validateWorkspaceArgs(profile.args || []);
        const executable = resolveExecutable(profile.executable);
        if (!executable)
          throw new Error('Workspace harness executable not found; run airelay doctor.');
        result = {
          profile: profileName,
          workspace,
          ...verifyNativeWorkspace(
            profile,
            workspace,
            executable,
            buildEnv(profile, getConfigPath(), true)
          ),
        };
      } else result = { workspace, manifest: verifySessionWorkspace(workspace).manifest };
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (!flags.json && !flags.j && action !== 'list')
    console.log(`Launch: airelay start <profile> --key <session-key> --workspace ${args[0]}`);
  return 0;
}
