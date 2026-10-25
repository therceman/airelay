import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceBindingSchema } from '../config/schema';
import { DEFAULT_CONFIG_DIR } from '../config/defaults';

export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;
export const DEFAULT_WORKSPACE_ROOT = path.join(DEFAULT_CONFIG_DIR, 'workspaces');
const MANIFEST = '.airelay-workspace.json';
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_FILES = 256;

const ManagedFileSchema = z
  .object({
    digest: z.string(),
    link: z.string().optional(),
    mode: z.number().int(),
  })
  .strict();
const ManifestSchema = z
  .object({
    version: z.literal(1),
    binding: WorkspaceBindingSchema,
    roleSelector: z.string().optional(),
    source: z.string().optional(),
    principalRef: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
      .optional(),
    allowedMcpServers: z.array(z.string()).max(64),
    files: z.record(z.string(), ManagedFileSchema),
  })
  .strict();
export type WorkspaceManifest = z.infer<typeof ManifestSchema>;

export interface WorkspaceOptions extends WorkspaceBinding {
  selector?: string;
  roleSelector?: string;
  root?: string;
  instructions?: string;
  instructionsText?: string;
  skillsDir?: string;
  mcpConfig?: string;
  source?: string;
  principalRef?: string;
  dryRun?: boolean;
  update?: boolean;
}

interface Asset {
  contents?: Buffer;
  link?: string;
  mode: number;
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

export function selectorParts(selector: string): string[] {
  const parts = selector.split('.');
  if (
    parts.length < 2 ||
    parts.length > 8 ||
    parts.some((p) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(p))
  )
    throw new Error('Invalid workspace selector; use dot-separated names such as rsg.lead.');
  return parts;
}

export function selectorPath(selector: string, root?: string): string {
  const base = workspaceRoot(root);
  const result = path.join(base, ...selectorParts(selector));
  assertNoSymlink(result);
  for (let parent = path.dirname(result); parent !== base; parent = path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, MANIFEST)))
      throw new Error(
        'Nested managed workspaces are ambiguous; use sibling Role/Agent directories.'
      );
  }
  return result;
}

export function workspacePath(binding: WorkspaceBinding, root?: string, selector?: string): string {
  WorkspaceBindingSchema.parse(binding);
  const base = workspaceRoot(root);
  if (selector && selectorParts(selector)[0] !== binding.project)
    throw new Error('Workspace selector and manifest project differ.');
  const result = selector
    ? selectorPath(selector, root)
    : binding.instance
      ? path.join(base, binding.project, 'instances', binding.instance)
      : path.join(base, binding.project, binding.role);
  if (binding.role === 'instances') throw new Error('The role name "instances" is reserved.');
  assertNoSymlink(result);
  return result;
}

function filePath(directory: string, name: string): string {
  const result = path.resolve(directory, name);
  if (!name || path.isAbsolute(name) || !inside(directory, result) || result === directory) {
    throw new Error('Invalid managed workspace file path.');
  }
  return result;
}

function digest(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function readBounded(file: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_ASSET_BYTES)
    throw new Error(`Invalid workspace asset: ${file}`);
  return fs.readFileSync(file);
}

export function listWorkspaceDirectory(directory: string): string[] {
  const handle = fs.opendirSync(directory);
  const entries: string[] = [];
  try {
    let entry: fs.Dirent | null;
    while ((entry = handle.readSync())) {
      if (entries.length >= MAX_ASSET_FILES)
        throw new Error('Workspace directory entry limit exceeded.');
      entries.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort();
}

function directoryHasEntries(directory: string): boolean {
  const handle = fs.opendirSync(directory);
  try {
    return handle.readSync() !== null;
  } finally {
    handle.closeSync();
  }
}

export function readWorkspace(
  binding: WorkspaceBinding,
  root?: string,
  selector?: string
): {
  directory: string;
  manifest: WorkspaceManifest;
} {
  const directory = workspacePath(binding, root, selector);
  const manifest = ManifestSchema.parse(
    JSON.parse(readBounded(path.join(directory, MANIFEST)).toString())
  );
  if (JSON.stringify(manifest.binding) !== JSON.stringify(WorkspaceBindingSchema.parse(binding))) {
    throw new Error('Workspace binding does not match its manifest.');
  }
  if (Object.keys(manifest.files).length > MAX_ASSET_FILES)
    throw new Error('Workspace file limit exceeded.');
  if (
    !manifest.files['AGENTS.md'] ||
    !manifest.files['.devin/mcp_config.json'] ||
    !manifest.files['.devin/mcp_config.local.json'] ||
    manifest.files['.devin/mcp_config.local.json'].mode !== 0o600
  )
    throw new Error('Required workspace assets or private MCP permissions are missing.');
  if (binding.instance && !manifest.files['.devin/skills']?.link)
    throw new Error('Instance canonical Skill link is missing.');
  let totalBytes = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = filePath(directory, name);
    assertNoSymlink(path.dirname(file));
    const stat = fs.lstatSync(file);
    if (expected.link !== undefined) {
      if (!binding.instance || !['AGENTS.md', '.devin/skills'].includes(name))
        throw new Error('Unsupported workspace link; credential files must be regular files.');
      if (!stat.isSymbolicLink() || fs.readlinkSync(file) !== expected.link) {
        throw new Error(`Workspace link changed: ${name}`);
      }
      const target = path.resolve(path.dirname(file), expected.link);
      if (!inside(workspaceRoot(root), target)) throw new Error('Workspace link escapes its root.');
    } else {
      totalBytes += stat.size;
      if (totalBytes > MAX_ASSET_BYTES) throw new Error('Workspace asset limit exceeded.');
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        digest(readBounded(file)) !== expected.digest
      ) {
        throw new Error(`Workspace asset changed: ${name}; review before reprovisioning.`);
      }
      if ((stat.mode & 0o777) !== expected.mode)
        throw new Error(`Workspace permissions changed: ${name}`);
    }
  }
  return { directory, manifest };
}

export function verifyWorkspaceFiles(
  binding: WorkspaceBinding,
  root?: string,
  selector?: string
): ReturnType<typeof readWorkspace> {
  const result = readWorkspace(binding, root, selector);
  if (fs.existsSync(path.join(workspaceRoot(root), binding.project, '.airelay-provision.lock'))) {
    throw new Error('Workspace provisioning is in progress; retry after it completes.');
  }
  if (!binding.instance) assertNoSymlink(path.join(result.directory, '.devin/skills'));
  if (binding.instance) {
    const roleSelector = result.manifest.roleSelector || `${binding.project}.${binding.role}`;
    if (selectorParts(roleSelector)[0] !== binding.project)
      throw new Error('Role reference must remain in the same project.');
    const role = verifyWorkspaceFiles(
      { project: binding.project, role: binding.role },
      root,
      roleSelector
    );
    for (const name of ['AGENTS.md', '.devin/skills']) {
      const expected = path.join(role.directory, name);
      if (fs.realpathSync(path.join(result.directory, name)) !== expected) {
        throw new Error('Instance role assets do not reference the canonical role.');
      }
    }
  }
  if (!binding.instance) {
    let entriesSeen = 0;
    const checkSkills = (directory: string, relative: string, depth = 0): void => {
      if (++entriesSeen > 1024 || depth > 8) throw new Error('Skill tree limit exceeded.');
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink()) throw new Error('Unexpected symlink in canonical Skills.');
      if (stat.isDirectory()) {
        const names = listWorkspaceDirectory(directory);
        for (const name of names)
          checkSkills(path.join(directory, name), path.join(relative, name), depth + 1);
      } else if (!result.manifest.files[relative])
        throw new Error('Unmanaged file in canonical Skills.');
    };
    checkSkills(path.join(result.directory, '.devin/skills'), '.devin/skills');
  }
  for (const name of ['.devin/config.json', '.devin/config.local.json']) {
    const file = path.join(result.directory, name);
    if (fs.lstatSync(file, { throwIfNoEntry: false }))
      throw new Error(`Unmanaged configuration in workspace: ${name}`);
  }
  return result;
}

export function provisionWorkspace(options: WorkspaceOptions): {
  directory: string;
  changed: string[];
  dryRun: boolean;
} {
  const binding = WorkspaceBindingSchema.parse({
    project: options.project,
    role: options.role,
    ...(options.instance ? { instance: options.instance } : {}),
  });
  const directory = workspacePath(binding, options.root, options.selector);
  const assets = new Map<string, Asset>();
  let totalBytes = 0;
  const add = (name: string, asset: Asset): void => {
    totalBytes += asset.contents?.length ?? 0;
    if (assets.size >= MAX_ASSET_FILES || totalBytes > MAX_ASSET_BYTES)
      throw new Error('Workspace asset limit exceeded.');
    assets.set(name, asset);
  };
  if (binding.instance) {
    if (
      options.instructions ||
      options.instructionsText !== undefined ||
      options.skillsDir ||
      options.source
    )
      throw new Error('Instance instructions, Skills, and source come from the canonical role.');
    const role = verifyWorkspaceFiles(
      { project: binding.project, role: binding.role },
      options.root,
      options.roleSelector
    );
    for (const name of ['AGENTS.md', '.devin/skills']) {
      add(name, {
        link: path.relative(
          path.dirname(path.join(directory, name)),
          path.join(role.directory, name)
        ),
        mode: 0o700,
      });
    }
  } else {
    if (options.instructions && options.instructionsText !== undefined)
      throw new Error('Provide an instructions file or text, not both.');
    if (!options.instructions && options.instructionsText === undefined)
      throw new Error('Role provisioning requires --instructions <file>.');
    add('AGENTS.md', {
      contents: options.instructions
        ? readBounded(path.resolve(options.instructions))
        : Buffer.from(options.instructionsText!),
      mode: 0o644,
    });
    if (options.skillsDir) {
      let entriesSeen = 0;
      const copy = (source: string, relative: string, depth = 0): void => {
        if (++entriesSeen > 1024 || depth > 8) throw new Error('Skill tree limit exceeded.');
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink())
          throw new Error('Skill source symlinks must be materialized explicitly.');
        if (stat.isDirectory()) {
          const entries = listWorkspaceDirectory(source);
          for (const name of entries)
            copy(path.join(source, name), path.join(relative, name), depth + 1);
        } else {
          add(relative, { contents: readBounded(source), mode: stat.mode & 0o777 });
        }
      };
      copy(path.resolve(options.skillsDir), '.devin/skills');
    }
  }
  const mcpContents = options.mcpConfig
    ? readBounded(path.resolve(options.mcpConfig))
    : Buffer.from('{"mcpServers":{}}\n');
  add('.devin/mcp_config.json', { contents: Buffer.from('{"mcpServers":{}}\n'), mode: 0o644 });
  let mcp: { mcpServers: Record<string, unknown> };
  try {
    mcp = z
      .object({ mcpServers: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(JSON.parse(mcpContents.toString()));
  } catch {
    throw new Error('Invalid MCP configuration; expected a JSON object with mcpServers.');
  }
  if (Object.keys(mcp.mcpServers).length > 64) throw new Error('MCP server limit exceeded.');
  if (Object.keys(mcp.mcpServers).some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)))
    throw new Error('Unsupported MCP server name.');
  add('.devin/mcp_config.local.json', { contents: mcpContents, mode: 0o600 });
  const manifest: WorkspaceManifest = {
    version: 1,
    binding,
    ...(options.roleSelector ? { roleSelector: options.roleSelector } : {}),
    ...(options.source ? { source: fs.realpathSync(options.source) } : {}),
    ...(options.principalRef ? { principalRef: options.principalRef } : {}),
    allowedMcpServers: Object.keys(mcp.mcpServers).sort(),
    files: Object.fromEntries(
      [...assets].map(([name, asset]) => [
        name,
        {
          digest: asset.contents ? digest(asset.contents) : digest(asset.link ?? ''),
          ...(asset.link !== undefined ? { link: asset.link } : {}),
          mode: asset.mode,
        },
      ])
    ),
  };
  const manifestPath = path.join(directory, MANIFEST);
  ManifestSchema.parse(manifest);
  let previous: WorkspaceManifest | undefined;
  if (fs.existsSync(manifestPath))
    previous = readWorkspace(binding, options.root, options.selector).manifest;
  else if (fs.existsSync(directory) && directoryHasEntries(directory))
    throw new Error('Existing workspace directory is unmanaged; nothing was overwritten.');
  const changed = [...assets]
    .filter(([name, asset]) => {
      const old = previous?.files[name];
      return (
        !old ||
        old.digest !== (asset.contents ? digest(asset.contents) : digest(asset.link ?? '')) ||
        old.mode !== asset.mode
      );
    })
    .map(([name]) => name);
  const removed = Object.keys(previous?.files ?? {}).filter((name) => !assets.has(name));
  if (
    previous &&
    !options.update &&
    (changed.length || removed.length || JSON.stringify(previous) !== JSON.stringify(manifest))
  ) {
    throw new Error('Workspace update requires --update after reviewing the planned changes.');
  }
  for (const name of changed) {
    const file = filePath(directory, name);
    assertNoSymlink(path.dirname(file));
    if (fs.lstatSync(file, { throwIfNoEntry: false }) && !previous?.files[name])
      throw new Error(`Unmanaged file would be overwritten: ${name}`);
  }
  const manifestChanged = JSON.stringify(previous) !== JSON.stringify(manifest);
  const plan = [...changed, ...removed, ...(manifestChanged ? [MANIFEST] : [])];
  if (options.dryRun || plan.length === 0)
    return { directory, changed: plan, dryRun: !!options.dryRun };
  const existed = fs.existsSync(directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  const lock = path.join(workspaceRoot(options.root), binding.project, '.airelay-provision.lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      'Workspace provisioning is already in progress; inspect .airelay-provision.lock.'
    );
  }
  const originals = new Map<string, Asset | null>();
  const atomicWrite = (file: string, contents: Buffer, mode: number): void => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, contents, { mode, flag: 'wx' });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  };
  try {
    // Recheck under the project lock before writing anything.
    if (previous) readWorkspace(binding, options.root, options.selector);
    else if (fs.existsSync(directory) && directoryHasEntries(directory))
      throw new Error('Workspace appeared while provisioning.');
    fs.mkdirSync(path.join(directory, '.devin'), { recursive: true, mode: 0o700 });
    if (!binding.instance)
      fs.mkdirSync(path.join(directory, '.devin/skills'), { recursive: true, mode: 0o700 });
    for (const name of [...changed, ...removed, MANIFEST]) {
      const file = filePath(directory, name);
      assertNoSymlink(path.dirname(file));
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      originals.set(
        name,
        !stat
          ? null
          : stat.isSymbolicLink()
            ? { link: fs.readlinkSync(file), mode: stat.mode & 0o777 }
            : { contents: readBounded(file), mode: stat.mode & 0o777 }
      );
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      assertNoSymlink(path.dirname(file));
      const asset = assets.get(name);
      if (name === MANIFEST)
        atomicWrite(file, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 0o600);
      else if (!asset) fs.unlinkSync(file);
      else if (asset.link !== undefined) {
        if (stat) fs.unlinkSync(file);
        fs.symlinkSync(asset.link, file);
      } else atomicWrite(file, asset.contents!, asset.mode);
    }
  } catch (error) {
    for (const [name, old] of [...originals].reverse()) {
      const file = filePath(directory, name);
      fs.rmSync(file, { force: true });
      if (old?.link !== undefined) fs.symlinkSync(old.link, file);
      else if (old?.contents) atomicWrite(file, old.contents, old.mode);
    }
    if (!existed) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmdirSync(lock);
  }
  return { directory, changed: plan, dryRun: false };
}
