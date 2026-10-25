import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Profile } from '../config/schema';
import { listWorkspaceDirectory } from './provision';
import { verifySessionWorkspace, type SessionWorkspace } from './binding';

export interface NativeWorkspaceInventory {
  directory: string;
  mcpServers: string[];
  skills: string[];
  instructionsVerified: boolean;
}

export function validateWorkspaceProfile(profile: Profile): void {
  const executable = profile.executable;
  const native =
    executable === 'devin' ||
    (path.isAbsolute(executable) &&
      path.basename(executable) === 'devin' &&
      !/[\s;&|$`'"<>\\]/.test(executable));
  if (!native || profile.createDirs?.length)
    throw new Error(
      'Managed workspaces require the native devin executable and do not support createDirs.'
    );
}

function nativeRead(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  deadline: number
): string {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Workspace native inspection exceeded its 10-second budget.');
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: remaining,
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Native diagnostics can contain configuration secrets; never surface their output.
    throw new Error(
      `Workspace preflight failed: native ${args[0]} inspection did not complete successfully.`
    );
  }
  return result.stdout;
}

export function validateWorkspaceArgs(args: string[]): void {
  const values = new Set([
    '--resume',
    '-r',
    '--model',
    '--permission-mode',
    '--verbosity',
    '--respect-workspace-trust',
  ]);
  const switches = new Set(['--continue', '-c', '--sandbox']);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') break;
    if (values.has(args[index]) && args[index + 1] && !args[index + 1].startsWith('-')) {
      index += 1;
      continue;
    }
    if (!switches.has(args[index]))
      throw new Error(
        'Unsupported workspace launch option; config-root overrides and alternate runtimes are not allowed.'
      );
  }
}

export function verifyNativeWorkspace(
  profile: Profile,
  workspace: SessionWorkspace,
  executable: string,
  env: Record<string, string>
): NativeWorkspaceInventory {
  validateWorkspaceProfile(profile);
  const { directory } = verifySessionWorkspace(workspace);
  const deadline = Date.now() + 10000;
  const mcpOutput = nativeRead(executable, ['mcp', 'list'], directory, env, deadline);
  if (!/Configured MCP servers|No MCP servers/i.test(mcpOutput))
    throw new Error('Unrecognized native MCP inventory; refusing workspace launch.');
  const entries = [...mcpOutput.matchAll(/^\s*\u2022[ \t]+(\S+)(?:[ \t]+.*)?$/gm)];
  const mcpServers = entries.map((match) => match[1]).sort();
  if (!mcpServers.length && !mcpOutput.trim().startsWith('No MCP servers configured.'))
    throw new Error('Unrecognized empty MCP inventory; refusing workspace launch.');
  if (mcpServers.length) {
    throw new Error(
      `Workspace requires zero MCP registrations (${mcpServers.length} discovered); inspect global, project, and imported configuration.`
    );
  }
  let skills: Array<{ name: string; provider: string; base_dir: string; errors?: unknown[] }>;
  try {
    const parsed: unknown = JSON.parse(
      nativeRead(executable, ['skills', 'list', '--json'], directory, env, deadline)
    );
    if (!Array.isArray(parsed)) throw new Error();
    skills = parsed;
  } catch {
    throw new Error('Could not verify native workspace Skill discovery.');
  }
  const skillsRoot = fs.realpathSync(path.join(directory, '.devin/skills'));
  const expected = listWorkspaceDirectory(skillsRoot)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')))
    .sort();
  const discovered: string[] = [];
  for (const skill of skills) {
    if (skill.provider === 'Builtin') continue;
    if (
      typeof skill.name !== 'string' ||
      typeof skill.base_dir !== 'string' ||
      skill.errors?.length
    )
      throw new Error('Invalid native Skill inventory.');
    if (
      !expected.includes(skill.name) ||
      fs.realpathSync(skill.base_dir) !== fs.realpathSync(path.join(skillsRoot, skill.name))
    ) {
      throw new Error(
        'Workspace discovered a foreign or unexpected Skill; inspect global Skills and imports.'
      );
    }
    discovered.push(skill.name);
  }
  if (JSON.stringify(discovered.sort()) !== JSON.stringify(expected))
    throw new Error('Not all approved workspace Skills were discovered.');
  const instructions = fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8').trim();
  const rules = nativeRead(executable, ['rules', 'list'], directory, env, deadline);
  const ruleNames = [...rules.matchAll(/^[ \t]+(.+?)[ \t]+\[([^\]]+)\]/gm)].map((match) => ({
    name: match[1],
    provider: match[2],
  }));
  if (
    ruleNames.length !== 1 ||
    ruleNames[0].name !== 'AGENTS' ||
    ruleNames[0].provider !== 'Standard'
  )
    throw new Error('Workspace discovered foreign or unexpected always-on instructions.');
  const ruleOutput = nativeRead(executable, ['rules', 'show', 'AGENTS'], directory, env, deadline);
  if (!instructions || !ruleOutput.includes(instructions))
    throw new Error("Native CLI did not load this agent Workspace's instructions.");
  return { directory, mcpServers, skills: discovered, instructionsVerified: true };
}
