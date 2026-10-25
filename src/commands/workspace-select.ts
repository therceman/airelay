import path from 'node:path';
import Enquirer from 'enquirer';
import { loadConfig } from '../config/load';
import { configSetCommand } from './config';
import {
  listWorkspaces,
  resolveSessionWorkspace,
  type SessionWorkspace,
} from '../workspace/binding';
import { selectorPath, workspaceRoot } from '../workspace/provision';
import {
  createLauncherWorkspace,
  findWorkspaceProject,
  sourceDirectory,
} from '../workspace/projects';
import { withAirelayPromptSymbols } from '../utils/enquirer';

async function rememberProject(source: string, workspace: SessionWorkspace): Promise<void> {
  const project = workspace.selector.split('.')[0];
  const links = loadConfig().settings.workspaceProjects ?? [];
  if (findWorkspaceProject(source, workspace.root, links)?.project === project) return;
  const result = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'confirm',
      name: 'remember',
      initial: false,
      message: `Remember ${source} -> ${project} for future launcher selections?`,
    })
  )) as { remember: boolean };
  if (!result.remember) return;
  // Re-read after the interactive pause so unrelated associations are preserved.
  const current = loadConfig().settings.workspaceProjects ?? [];
  configSetCommand(
    'settings.workspaceProjects',
    JSON.stringify([
      ...current.filter((link) => link.source !== source),
      { source, root: workspace.root, project },
    ])
  );
}

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
      message: 'New Workspace selector (project.role or project.folder.role)',
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
  const instructions = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'input',
      name: 'instructions',
      message: 'Instructions file (relative to source; empty creates a minimal AGENTS.md)',
    })
  )) as { instructions: string };
  const options = {
    selector: result.selector,
    root,
    source,
    instructions: instructions.instructions || undefined,
  };
  const plan = createLauncherWorkspace({ ...options, dryRun: true });
  const confirm = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'confirm',
      name: 'create',
      initial: false,
      message: `Create ${plan.directory} for ${source} with empty Skills and zero MCP?`,
    })
  )) as { create: boolean };
  if (!confirm.create) return undefined;
  createLauncherWorkspace(options);
  return resolveSessionWorkspace(result.selector, root);
}

export async function chooseSessionWorkspace(
  directory = process.cwd()
): Promise<SessionWorkspace | undefined> {
  const source = sourceDirectory(directory);
  const config = loadConfig();
  const root = workspaceRoot(config.settings.workspaceRoot);
  const workspaces = listWorkspaces(root);
  const remembered = findWorkspaceProject(source, root, config.settings.workspaceProjects);
  let prefix =
    remembered && workspaces.some((w) => w.selector.startsWith(`${remembered.project}.`))
      ? remembered.project
      : '';
  for (;;) {
    const children = [
      ...new Set(
        workspaces
          .filter((w) => !prefix || w.selector.startsWith(`${prefix}.`))
          .map((w) => w.selector.split('.')[prefix ? prefix.split('.').length : 0])
      ),
    ].sort();
    const result = (await Enquirer.prompt(
      withAirelayPromptSymbols({
        type: 'select',
        name: 'workspace',
        message: prefix
          ? `Select within ${prefix} (${root})`
          : `Select a Workspace project (${root})`,
        choices: [
          ...children.map((name) => ({
            name: `node:${prefix ? `${prefix}.` : ''}${name}`,
            message: name,
          })),
          { name: 'create', message: 'Create new Workspace...' },
          ...(prefix ? [{ name: 'back', message: 'Back to parent / all projects' }] : []),
          { name: 'none', message: 'Without workspace (normal profile/current directory)' },
        ],
        initial: 0,
      })
    )) as { workspace: string };
    if (result.workspace === 'none') return undefined;
    if (result.workspace === 'back' && prefix) {
      prefix = prefix.split('.').slice(0, -1).join('.');
      continue;
    }
    if (result.workspace === 'create') {
      const created = await createWorkspace(root, prefix, source);
      if (created) {
        await rememberProject(source, created);
        return created;
      }
      continue;
    }
    const selected = result.workspace.startsWith('node:') ? result.workspace.slice(5) : '';
    if (!children.some((name) => selected === `${prefix ? `${prefix}.` : ''}${name}`))
      throw new Error('Selected workspace is not available; retry the launcher.');
    if (!workspaces.some((w) => w.selector === selected)) {
      prefix = selected;
      continue;
    }
    const workspace = resolveSessionWorkspace(selected, root);
    await rememberProject(source, workspace);
    return workspace;
  }
}
