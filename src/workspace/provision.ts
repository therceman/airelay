import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceBindingSchema } from '../config/schema';
import { DEFAULT_CONFIG_DIR } from '../config/defaults';

export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;
export const DEFAULT_WORKSPACE_ROOT = path.join(DEFAULT_CONFIG_DIR, 'workspaces');
const MANIFEST = '.airelay-workspace.json';
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const ManifestSchema = z
  .object({
    version: z.literal(2),
    binding: WorkspaceBindingSchema,
    source: z.string().optional(),
  })
  .strict();
export type WorkspaceManifest = z.infer<typeof ManifestSchema>;
export interface WorkspaceOptions extends WorkspaceBinding {
  root?: string;
  source?: string;
  dryRun?: boolean;
}

export function workspaceRoot(root = DEFAULT_WORKSPACE_ROOT): string {
  if (!path.isAbsolute(root) && !/^~(?:\/|$)/.test(root))
    throw new Error('Workspace root must be an absolute path or start with ~/.');
  return path.resolve(root.replace(/^~(?=\/|$)/, os.homedir()));
}
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function assertNoSymlink(target: string): void {
  let current = path.resolve(target);
  while (current !== path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Unexpected symlink: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    current = path.dirname(current);
  }
}
export function selectorParts(selector: string): [string, string] {
  const parts = selector.split('.');
  if (parts.length !== 2 || parts.some((p) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(p)))
    throw new Error('Invalid workspace selector; use <project>.<agent>, such as agentvm.lead.');
  return [parts[0], parts[1]];
}
export function selectorPath(selector: string, root?: string): string {
  const [project, agent] = selectorParts(selector);
  const result = path.join(workspaceRoot(root), project, 'agents', agent);
  assertNoSymlink(result);
  return result;
}
export function workspacePath(binding: WorkspaceBinding, root?: string): string {
  const parsed = WorkspaceBindingSchema.parse(binding);
  return selectorPath(`${parsed.project}.${parsed.agent}`, root);
}
export function listWorkspaceDirectory(directory: string): string[] {
  const handle = fs.opendirSync(directory);
  const entries: string[] = [];
  try {
    let entry: fs.Dirent | null;
    while ((entry = handle.readSync())) {
      if (entries.length >= 256) throw new Error('Workspace directory entry limit exceeded.');
      entries.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort();
}

const ownedLocks = new Set<string>();
function lockPath(root: string): string {
  return path.join(path.dirname(root), `.${path.basename(root)}.workspace.lock`);
}
function assertUnlocked(root: string): void {
  if (!ownedLocks.has(root) && fs.existsSync(lockPath(root)))
    throw new Error('Workspace operation in progress; inspect the workspace lock before retrying.');
}
/** Serializes provisioning/reservation with explicit offline workspace maintenance. */
export function withWorkspaceLock<T>(root: string | undefined, action: () => T): T {
  const base = workspaceRoot(root);
  assertNoSymlink(base);
  if (ownedLocks.has(base)) return action();
  fs.mkdirSync(path.dirname(base), { recursive: true, mode: 0o700 });
  const lock = lockPath(base);
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error('Workspace operation in progress; inspect the workspace lock before retrying.');
  }
  ownedLocks.add(base);
  try {
    return action();
  } finally {
    ownedLocks.delete(base);
    fs.rmdirSync(lock);
  }
}
function readBounded(file: string): Buffer {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_ASSET_BYTES)
    throw new Error(`Invalid workspace asset: ${file}`);
  return fs.readFileSync(file);
}
export function readWorkspace(
  binding: WorkspaceBinding,
  root?: string
): { directory: string; manifest: WorkspaceManifest } {
  const base = workspaceRoot(root);
  assertUnlocked(base);
  const directory = workspacePath(binding, base);
  const file = path.join(directory, MANIFEST);
  assertNoSymlink(file);
  let manifest: WorkspaceManifest;
  try {
    manifest = ManifestSchema.parse(JSON.parse(readBounded(file).toString()));
  } catch {
    throw new Error(
      'Missing or unsupported agent Workspace manifest; create a new Workspace or explicitly migrate unused old directories.'
    );
  }
  const expected = WorkspaceBindingSchema.parse(binding);
  if (manifest.binding.project !== expected.project || manifest.binding.agent !== expected.agent)
    throw new Error('Workspace binding does not match its manifest.');
  return { directory, manifest };
}

export function verifyWorkspaceFiles(
  binding: WorkspaceBinding,
  root?: string
): ReturnType<typeof readWorkspace> {
  const result = readWorkspace(binding, root);
  const base = workspaceRoot(root);
  let entries = 0,
    bytes = 0;
  const walk = (file: string, ancestors: Set<string>, depth = 0): void => {
    if (++entries > 1024 || depth > 8) throw new Error('Workspace asset tree limit exceeded.');
    const real = fs.realpathSync(file);
    if (!inside(base, real)) throw new Error('Workspace asset link escapes its root.');
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      if (ancestors.has(real)) throw new Error('Workspace asset link cycle.');
      const next = new Set(ancestors).add(real);
      for (const name of listWorkspaceDirectory(file)) walk(path.join(file, name), next, depth + 1);
    } else {
      bytes += stat.size;
      if (!stat.isFile() || stat.size > MAX_ASSET_BYTES || bytes > MAX_ASSET_BYTES)
        throw new Error('Workspace asset limit exceeded.');
    }
  };
  walk(path.join(result.directory, 'AGENTS.md'), new Set());
  walk(path.join(result.directory, '.devin/skills'), new Set());
  for (const name of ['mcp_config.json', 'mcp_config.local.json']) {
    const file = path.join(result.directory, '.devin', name);
    assertNoSymlink(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (name.endsWith('.local.json') && (stat.mode & 0o777) !== 0o600))
      throw new Error('Private MCP configuration must be a regular file with mode 0600.');
    let config: { mcpServers: Record<string, unknown> };
    try {
      config = z
        .object({ mcpServers: z.record(z.string(), z.unknown()) })
        .strict()
        .parse(JSON.parse(readBounded(file).toString()));
    } catch {
      throw new Error('Invalid MCP configuration; expected an object with empty mcpServers.');
    }
    if (Object.keys(config.mcpServers).length)
      throw new Error('Managed Workspace requires zero MCP registrations.');
  }
  for (const name of ['.devin/config.json', '.devin/config.local.json']) {
    if (fs.lstatSync(path.join(result.directory, name), { throwIfNoEntry: false }))
      throw new Error(`Unmanaged configuration in workspace: ${name}`);
  }
  return result;
}

export function provisionWorkspace(options: WorkspaceOptions): {
  directory: string;
  changed: string[];
  dryRun: boolean;
} {
  const binding = WorkspaceBindingSchema.parse({ project: options.project, agent: options.agent });
  const directory = workspacePath(binding, options.root);
  const source = options.source ? fs.realpathSync(options.source) : undefined;
  if (source && !fs.statSync(source).isDirectory())
    throw new Error('Project source must be a directory.');
  const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (existing) {
    if (!fs.existsSync(path.join(directory, MANIFEST)))
      throw new Error('Existing Workspace directory is unmanaged; nothing was overwritten.');
    const current = verifyWorkspaceFiles(binding, options.root);
    if (source && current.manifest.source !== source)
      throw new Error(
        'Workspace source differs; review its manifest explicitly before changing it.'
      );
    return { directory, changed: [], dryRun: !!options.dryRun };
  }
  const changed = [
    'AGENTS.md',
    '.devin/skills',
    '.devin/mcp_config.json',
    '.devin/mcp_config.local.json',
    MANIFEST,
  ];
  if (options.dryRun) return { directory, changed, dryRun: true };
  return withWorkspaceLock(options.root, () => {
    if (fs.existsSync(directory)) throw new Error('Workspace appeared while provisioning; retry.');
    const parent = path.dirname(directory);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    assertNoSymlink(parent);
    const staging = path.join(parent, `.workspace-${randomUUID()}`);
    try {
      fs.mkdirSync(path.join(staging, '.devin/skills'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(staging, 'AGENTS.md'),
        `# ${binding.project}.${binding.agent}\n\n${source ? `Source repository: ${JSON.stringify(source)}\n\n` : ''}Read the source project's instructions before editing.\nInstructions and Skills in this Workspace are maintained by the agent/user.\nNo MCP servers are configured.\n`,
        { mode: 0o644, flag: 'wx' }
      );
      for (const name of ['mcp_config.json', 'mcp_config.local.json'])
        fs.writeFileSync(path.join(staging, '.devin', name), '{"mcpServers":{}}\n', {
          mode: name.endsWith('.local.json') ? 0o600 : 0o644,
          flag: 'wx',
        });
      fs.writeFileSync(
        path.join(staging, MANIFEST),
        JSON.stringify({ version: 2, binding, ...(source ? { source } : {}) }, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' }
      );
      if (fs.existsSync(directory))
        throw new Error('Workspace appeared while provisioning; nothing overwritten.');
      fs.renameSync(staging, directory);
      return { directory, changed, dryRun: false };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
}
