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
import { migrateWorkspaceProfiles } from '../workspace/migrate-profiles';

export function workspaceCommand(
  action: string | undefined,
  args: string[],
  flags: Record<string, string | boolean>
): number {
  if (!action || action === 'help') {
    console.log(
      [
        'airelay workspace provision <selector> --instructions <file> [--skills-dir <dir>] [--source <repo>] [--update] [--dry-run]',
        'airelay workspace provision <agent-selector> --role-workspace <role-selector> [--principal <label>]',
        'airelay workspace inspect <selector> [--json]',
        'airelay workspace verify <selector> [--profile <profile>] [--json]',
        'airelay workspace list [--json]',
        'airelay workspace migrate-profiles [--dry-run] [--json]',
        'Launch: airelay start <profile> --key <session-key> --workspace <selector>',
        'Root: settings.workspaceRoot (fresh default ~/.airelay/workspaces). No profiles are generated. Managed verification currently supports native Devin; zero MCP is required.',
      ].join('\n')
    );
    return 0;
  }
  const actions = ['provision', 'inspect', 'verify', 'list', 'migrate-profiles'];
  if (
    !actions.includes(action) ||
    args.length !== (['list', 'migrate-profiles'].includes(action) ? 0 : 1)
  )
    throw new Error(
      'Usage: airelay workspace <provision|inspect|verify> <selector>; see airelay workspace help.'
    );
  const allowed = new Set([
    'json',
    'j',
    ...(action === 'verify' ? ['profile'] : []),
    ...(action === 'provision'
      ? ['instructions', 'skills-dir', 'source', 'principal', 'role-workspace', 'update']
      : []),
    ...(['provision', 'migrate-profiles'].includes(action) ? ['dry-run', 'n'] : []),
  ]);
  for (const [name, flag] of Object.entries(flags)) {
    if (!allowed.has(name))
      throw new Error(`Unknown workspace option --${name}; see airelay workspace help.`);
    if (['json', 'j', 'dry-run', 'n', 'update'].includes(name) && flag !== true)
      throw new Error(`--${name} does not take a value.`);
  }
  const value = (name: string): string | undefined => {
    if (flags[name] === undefined) return undefined;
    if (typeof flags[name] !== 'string') throw new Error(`--${name} requires a value.`);
    return flags[name] as string;
  };
  const dryRun = flags['dry-run'] === true || flags.n === true;
  if (action === 'migrate-profiles') {
    console.log(JSON.stringify(migrateWorkspaceProfiles(dryRun), null, 2));
    return 0;
  }
  const config = loadConfig(),
    root = config.settings.workspaceRoot;
  let result: unknown;
  if (action === 'list') result = { root: workspaceRoot(root), workspaces: listWorkspaces(root) };
  else {
    const selector = args[0],
      parts = selectorParts(selector);
    if (action === 'provision') {
      const roleSelector = value('role-workspace');
      const role = roleSelector
        ? verifySessionWorkspace(resolveSessionWorkspace(roleSelector, root))
        : undefined;
      if (role?.manifest.binding.instance)
        throw new Error('Role reference must name a canonical Role, not an Agent instance.');
      if (role && role.manifest.binding.project !== parts[0])
        throw new Error('Agent and Role must be in the same project.');
      result = {
        selector,
        ...provisionWorkspace({
          project: parts[0],
          role: role ? role.manifest.binding.role : parts[parts.length - 1],
          ...(role ? { instance: parts[parts.length - 1], roleSelector } : {}),
          selector,
          root,
          instructions: value('instructions'),
          skillsDir: value('skills-dir'),
          source: value('source'),
          principalRef: value('principal'),
          update: flags.update === true,
          dryRun,
        }),
      };
    } else {
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
