import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { ConfigSchema, Profile, WorkspaceBindingSchema } from '../config/schema';
import { getConfigPath, loadConfig } from '../config/load';
import { buildEnv } from '../runtime/env';
import { resolveExecutable } from '../runtime/resolveExecutable';
import { provisionWorkspace, verifyWorkspaceFiles, workspacePath } from '../workspace/provision';
import {
  validateWorkspaceArgs,
  validateWorkspaceProfile,
  verifyNativeWorkspace,
} from '../workspace/verify';

export function workspaceProfileName(project: string, role: string, instance?: string): string {
  return `workspace-${project}-${role}${instance ? `-${instance}` : ''}`;
}

export function workspaceCommand(
  action: string | undefined,
  args: string[],
  flags: Record<string, string | boolean>
): number {
  if (action === 'help' || !action) {
    console.log(
      [
        'airelay workspace provision <project> <role> --instructions <file> [--skills-dir <dir>] [--mcp-config <file>] [--source <repo>] [--principal <label>] [--instance <name>] [--dry-run] [--update]',
        'airelay workspace inspect <project> <role> [--instance <name>] [--json]',
        'airelay workspace verify <project> <role> [--instance <name>] [--json]',
        'Root: settings.workspaceRoot (default ~/agent-workspaces). Launch/resume the generated profile with normal airelay start/resume commands.',
        'Native discovery verification currently supports Devin. Authentication uses the normal native login store; inherited credential variables are removed.',
      ].join('\n')
    );
    return 0;
  }
  if (!['provision', 'inspect', 'verify'].includes(action) || args.length !== 2)
    throw new Error(
      'Usage: airelay workspace <provision|inspect|verify> <project> <role>; see airelay workspace help.'
    );
  const permitted = new Set([
    'instance',
    'json',
    'j',
    ...(action === 'provision'
      ? [
          'instructions',
          'skills-dir',
          'mcp-config',
          'source',
          'principal',
          'dry-run',
          'n',
          'update',
        ]
      : []),
  ]);
  for (const [name, flag] of Object.entries(flags)) {
    if (!permitted.has(name))
      throw new Error(`Unknown workspace option --${name}; see airelay workspace help.`);
    if (['dry-run', 'n', 'update', 'json', 'j'].includes(name) && flag !== true)
      throw new Error(`--${name} does not take a value.`);
  }
  const value = (name: string): string | undefined => {
    if (flags[name] === undefined) return undefined;
    if (typeof flags[name] !== 'string') throw new Error(`--${name} requires a value.`);
    return flags[name] as string;
  };
  const binding = WorkspaceBindingSchema.parse({
    project: args[0],
    role: args[1],
    ...(value('instance') ? { instance: value('instance') } : {}),
  });
  const configPath = getConfigPath();
  const config = loadConfig(configPath);
  const root = config.settings.workspaceRoot;
  const profileName = workspaceProfileName(binding.project, binding.role, binding.instance);
  const profile: Profile = {
    executable: 'devin',
    cwd: workspacePath(binding, root),
    workspace: binding,
  };
  let result: unknown;
  if (action === 'provision') {
    const previous = fs.readFileSync(configPath, 'utf8');
    const existing = config.profiles[profileName];
    if (existing && JSON.stringify(existing) !== JSON.stringify(profile))
      throw new Error(
        `Profile ${profileName} already has different settings; nothing was overwritten.`
      );
    result = provisionWorkspace({
      ...binding,
      root,
      instructions: value('instructions'),
      skillsDir: value('skills-dir'),
      mcpConfig: value('mcp-config'),
      source: value('source'),
      principalRef: value('principal'),
      dryRun: flags['dry-run'] === true || flags.n === true,
      update: flags.update === true,
    });
    if (flags['dry-run'] !== true && flags.n !== true && !existing) {
      if (fs.readFileSync(configPath, 'utf8') !== previous)
        throw new Error(
          'Airelay config changed during provisioning; retry to register the prepared workspace.'
        );
      const document = YAML.parseDocument(previous);
      document.setIn(['profiles', profileName], profile);
      ConfigSchema.parse(document.toJS());
      const temporary = `${configPath}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, document.toString(), {
          mode: fs.statSync(configPath).mode & 0o777,
          flag: 'wx',
        });
        fs.renameSync(temporary, configPath);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
  } else {
    const workspace = verifyWorkspaceFiles(binding, root);
    if (action === 'verify') {
      const selected = config.profiles[profileName];
      if (!selected || JSON.stringify(selected.workspace) !== JSON.stringify(binding))
        throw new Error(
          'Workspace profile is missing or its binding changed; inspect the Airelay configuration.'
        );
      validateWorkspaceProfile(selected);
      validateWorkspaceArgs(selected.args ?? []);
      const executable = resolveExecutable(selected.executable);
      if (!executable)
        throw new Error('Workspace harness executable not found; run airelay doctor.');
      result = verifyNativeWorkspace(selected, root, executable, buildEnv(selected, configPath));
    } else {
      result = {
        directory: workspace.directory,
        binding,
        source: workspace.manifest.source,
        principalRef: workspace.manifest.principalRef,
        allowedMcpServers: workspace.manifest.allowedMcpServers,
        managedFiles: Object.keys(workspace.manifest.files),
      };
    }
  }
  const output = { profile: profileName, ...(result as Record<string, unknown>) };
  console.log(
    flags.json
      ? JSON.stringify(output, null, 2)
      : `${JSON.stringify(output, null, 2)}\nLaunch: airelay start ${profileName} --key <session-key>`
  );
  return 0;
}
