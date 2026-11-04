import path from 'node:path';
import Enquirer from 'enquirer';
import { loadConfig } from '../config/load';
import { getLaunchHistory } from './history';
import {
  listWorkspaces,
  resolveSessionWorkspace,
  type SessionWorkspace,
} from '../workspace/binding';
import { selectorPath, workspaceRoot } from '../workspace/provision';
import { createLauncherWorkspace, sourceDirectory } from '../workspace/projects';
import { withAirelayPromptSymbols } from '../utils/enquirer';

async function createWorkspace(
  root: string,
  prefix: string,
  source: string
): Promise<SessionWorkspace | undefined> {
  const suggestedProject = path
    .basename(source)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 64);
  const result = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'input',
      name: 'selector',
      message: 'New Workspace selector (<project>.<agent>)',
      initial: `${prefix || suggestedProject || 'project'}.lead`,
      validate: (value: string) => {
        try {
          selectorPath(value, root);
          return true;
        } catch (error) {
          return (error as Error).message;
        }
      },
    })
  )) as { selector: string };
  // Validate outside the prompt too; prompt adapters are not a trust boundary.
  selectorPath(result.selector, root);
  const options = {
    selector: result.selector,
    root,
    source,
  };
  createLauncherWorkspace({ ...options, dryRun: true });
  const confirm = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'confirm',
      name: 'create',
      initial: false,
      message: `Create Workspace ${result.selector}?`,
    })
  )) as { create: boolean };
  if (!confirm.create) return undefined;
  createLauncherWorkspace(options);
  return resolveSessionWorkspace(result.selector, root);
}

export async function chooseSessionWorkspace(
  directory = process.cwd()
): Promise<SessionWorkspace | undefined> {
  const config = loadConfig();
  const root = workspaceRoot(config.settings.workspaceRoot);
  const workspaces = listWorkspaces(root);
  const available = new Map(workspaces.map((workspace) => [workspace.selector, workspace]));
  const usage = new Map<string, number>();
  for (const entry of getLaunchHistory({ readOnly: true })) {
    const saved = entry.workspace;
    if (!saved) continue;
    const current = available.get(saved.selector);
    if (!current || current.root !== saved.root || current.path !== saved.path) continue;
    const usedAt = entry.lastUsed ?? entry.startedAt;
    for (const key of [current.selector, current.selector.split('.')[0]]) {
      const previous = usage.get(key);
      if (previous === undefined || usedAt > previous) usage.set(key, usedAt);
    }
  }
  let prefix = '';
  for (;;) {
    const children = [
      ...new Set(
        workspaces
          .filter((w) => !prefix || w.selector.startsWith(`${prefix}.`))
          .map((w) => w.selector.split('.')[prefix ? prefix.split('.').length : 0])
      ),
    ].sort((a, b) => {
      const aUsed = usage.get(prefix ? `${prefix}.${a}` : a);
      const bUsed = usage.get(prefix ? `${prefix}.${b}` : b);
      if (aUsed === bUsed) return a.localeCompare(b);
      if (aUsed === undefined) return 1;
      if (bUsed === undefined) return -1;
      return bUsed - aUsed;
    });
    const choices = [
      ...children.map((name) => ({
        name: `node:${prefix ? `${prefix}.` : ''}${name}`,
        message: name,
      })),
      { name: 'create', message: 'Create new Workspace...' },
      { name: 'none', message: 'Without workspace (normal profile/current directory)' },
    ];
    const result = (await Enquirer.prompt(
      withAirelayPromptSymbols({
        type: 'select',
        name: 'workspace',
        message: prefix
          ? `Select an agent in ${prefix} (${root})`
          : `Select a Workspace project (${root})`,
        choices,
        initial: 0,
        // Enquirer displays choice.name after submit; keep IDs out of the visible label.
        format(
          this: {
            state: { submitted: boolean; cancelled: boolean };
            styles: { primary: (label: string) => string };
          },
          value: string
        ) {
          if (!this.state.submitted || this.state.cancelled) return '';
          const label = choices.find((choice) => choice.name === value)?.message;
          return label ? this.styles.primary(label) : '';
        },
      })
    )) as { workspace: string };
    if (result.workspace === 'none') return undefined;
    if (result.workspace === 'create') {
      const created = await createWorkspace(root, prefix, sourceDirectory(directory));
      if (created) return created;
      continue;
    }
    const selected = result.workspace.startsWith('node:') ? result.workspace.slice(5) : '';
    if (!children.some((name) => selected === `${prefix ? `${prefix}.` : ''}${name}`))
      throw new Error('Selected workspace is not available; retry the launcher.');
    if (!workspaces.some((w) => w.selector === selected)) {
      prefix = selected;
      continue;
    }
    return resolveSessionWorkspace(selected, root);
  }
}
