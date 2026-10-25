import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  assertNoSymlink,
  listWorkspaceDirectory,
  selectorParts,
  selectorPath,
  verifyWorkspaceFiles,
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
  const manifestPath = path.join(workspace.path, '.airelay-workspace.json');
  assertNoSymlink(manifestPath);
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
    throw new Error('Missing or invalid workspace manifest.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = verifyWorkspaceFiles(manifest.binding, workspace.root);
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
  let visited = 0;
  const result: SessionWorkspace[] = [];
  const walk = (directory: string, depth: number): void => {
    if (++visited > 1024 || depth > 8) throw new Error('Workspace discovery limit exceeded.');
    if (fs.existsSync(path.join(directory, '.airelay-workspace.json'))) {
      const parts = path.relative(base, directory).split(path.sep);
      if (parts.length !== 3 || parts[1] !== 'agents')
        throw new Error(
          'Unsupported Workspace layout; explicitly migrate or remove unused old directories after backup.'
        );
      const selector = `${parts[0]}.${parts[2]}`;
      selectorParts(selector);
      result.push(resolveSessionWorkspace(selector, base));
      return;
    }
    for (const name of listWorkspaceDirectory(directory)) {
      if (name.startsWith('.')) continue;
      const child = path.join(directory, name),
        stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error('Unexpected workspace discovery symlink.');
      if (stat.isDirectory()) walk(child, depth + 1);
    }
  };
  walk(base, 0);
  return result.sort((a, b) => a.selector.localeCompare(b.selector));
}
