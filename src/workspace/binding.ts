import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  assertNoSymlink,
  readWorkspace,
  selectorParts,
  selectorPath,
  workspaceRoot,
} from './provision';

export const SessionWorkspaceSchema = z
  .object({
    selector: z.string(),
    root: z.string(),
    path: z.string(),
  })
  .strict();
export type SessionWorkspace = z.infer<typeof SessionWorkspaceSchema>;

export function sameWorkspace(a?: SessionWorkspace, b?: SessionWorkspace): boolean {
  return (
    JSON.stringify(a && SessionWorkspaceSchema.parse(a)) ===
    JSON.stringify(b && SessionWorkspaceSchema.parse(b))
  );
}

export function verifySessionWorkspace(input: SessionWorkspace) {
  const workspace = SessionWorkspaceSchema.parse(input);
  if (
    !path.isAbsolute(workspace.root) ||
    !path.isAbsolute(workspace.path) ||
    workspace.root !== workspaceRoot(workspace.root) ||
    workspace.path !== selectorPath(workspace.selector, workspace.root)
  )
    throw new Error(
      'Invalid saved workspace path; explicit migration or a new session is required.'
    );
  assertNoSymlink(workspace.root);
  if (
    fs.realpathSync(workspace.root) !== workspace.root ||
    fs.realpathSync(workspace.path) !== workspace.path
  )
    throw new Error('Workspace real path changed; refusing launch.');
  const [project, agent] = selectorParts(workspace.selector);
  const result = readWorkspace({ project, agent }, workspace.root);
  return { ...result, workspace };
}

export function resolveSessionWorkspace(selector: string, root?: string): SessionWorkspace {
  const workspace = { selector, root: workspaceRoot(root), path: selectorPath(selector, root) };
  return verifySessionWorkspace(workspace).workspace;
}

export function assertWorkspaceBinding(
  key: string,
  workspace: SessionWorkspace | undefined,
  entries: Array<{ sessionKey?: string; workspace?: SessionWorkspace }>
): void {
  for (const entry of entries.filter((candidate) => candidate.sessionKey === key)) {
    if (!sameWorkspace(entry.workspace, workspace))
      throw new Error(
        `Session key ${key} has a different Workspace binding. Use airelay resume ${key}, explicit migration, or a new session key.`
      );
  }
}

export function listWorkspaces(root?: string): SessionWorkspace[] {
  const base = workspaceRoot(root);
  assertNoSymlink(base);
  if (!fs.existsSync(base)) return [];
  const result: SessionWorkspace[] = [];
  // Only the defined project/agents/agent layout is discoverable; never walk
  // arbitrary project files or follow links while building the menu.
  function* entries(directory: string): Generator<fs.Dirent> {
    const handle = fs.opendirSync(directory);
    try {
      let entry: fs.Dirent | null;
      while ((entry = handle.readSync())) yield entry;
    } finally {
      handle.closeSync();
    }
  }
  for (const project of entries(base)) {
    if (!project.isDirectory() || project.name.startsWith('.')) continue;
    const agents = path.join(base, project.name, 'agents');
    const stat = fs.lstatSync(agents, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    for (const agent of entries(agents)) {
      if (!agent.isDirectory() || agent.name.startsWith('.')) continue;
      const directory = path.join(agents, agent.name);
      if (!fs.existsSync(path.join(directory, '.airelay-workspace.json'))) continue;
      const selector = `${project.name}.${agent.name}`;
      selectorParts(selector);
      result.push(resolveSessionWorkspace(selector, base));
    }
  }
  return result.sort((a, b) => a.selector.localeCompare(b.selector));
}
