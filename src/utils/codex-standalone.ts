import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveExecutable } from '../runtime/resolveExecutable';

const CODEX_STANDALONE_RELATIVE_PATH = path.join(
  'packages',
  'standalone',
  'current',
  process.platform === 'win32' ? 'codex.exe' : 'codex'
);

function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath) || fs.lstatSync(filePath, { throwIfNoEntry: false }) !== undefined;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getTargetTriple(): { packageName: string; target: string; fileName: string } | null {
  const platform = `${process.platform}-${process.arch}`;
  const targets: Record<string, { packageName: string; target: string; fileName: string }> = {
    'linux-x64': {
      packageName: 'codex-linux-x64',
      target: 'x86_64-unknown-linux-musl',
      fileName: 'codex',
    },
    'linux-arm64': {
      packageName: 'codex-linux-arm64',
      target: 'aarch64-unknown-linux-musl',
      fileName: 'codex',
    },
    'darwin-x64': {
      packageName: 'codex-darwin-x64',
      target: 'x86_64-apple-darwin',
      fileName: 'codex',
    },
    'darwin-arm64': {
      packageName: 'codex-darwin-arm64',
      target: 'aarch64-apple-darwin',
      fileName: 'codex',
    },
    'win32-x64': {
      packageName: 'codex-win32-x64',
      target: 'x86_64-pc-windows-msvc',
      fileName: 'codex.exe',
    },
    'win32-arm64': {
      packageName: 'codex-win32-arm64',
      target: 'aarch64-pc-windows-msvc',
      fileName: 'codex.exe',
    },
  };
  return targets[platform] || null;
}

function findInstalledNativeCodex(): string | null {
  const resolved = resolveExecutable('codex');
  if (!resolved) return null;

  let realExecutable: string;
  try {
    realExecutable = fs.realpathSync(resolved);
  } catch {
    return null;
  }

  if (path.basename(realExecutable) === (process.platform === 'win32' ? 'codex.exe' : 'codex')) {
    if (isExecutable(realExecutable)) return realExecutable;
  }

  const target = getTargetTriple();
  if (!target) return null;

  // The npm launcher resolves to <package>/bin/codex.js. Resolve the native
  // optional package relative to that package root instead of hard-coding a
  // global npm installation directory.
  let current = path.dirname(realExecutable);
  const filesystemRoot = path.parse(current).root;
  while (current !== filesystemRoot) {
    const candidate = path.join(
      current,
      'node_modules',
      '@openai',
      target.packageName,
      'vendor',
      target.target,
      'bin',
      target.fileName
    );
    if (isExecutable(candidate)) return candidate;
    current = path.dirname(current);
  }
  return null;
}

function ensureSymlink(source: string, destination: string): void {
  if (pathExists(destination)) {
    if (isExecutable(destination) && fs.lstatSync(destination).isSymbolicLink()) return;
    throw new Error(`Codex managed path exists but is not a usable symlink: ${destination}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.symlinkSync(source, destination, 'file');
}

/**
 * Make Codex's installer-managed path available from the installed native
 * package. This is idempotent and never downloads or replaces Codex.
 */
export function ensureCodexStandaloneExecutable(
  baseDir = path.join(os.homedir(), '.codex'),
  sourceOverride?: string
): string {
  const destination = path.join(baseDir, CODEX_STANDALONE_RELATIVE_PATH);
  if (isExecutable(destination)) return destination;

  const source = sourceOverride || findInstalledNativeCodex();
  if (!source || !isExecutable(source)) {
    throw new Error(
      `Managed standalone Codex binary is unavailable. Install Codex with: curl -fsSL https://chatgpt.com/codex/install.sh | sh`
    );
  }
  ensureSymlink(source, destination);
  return destination;
}

/** Ensure an overlay resolves the same standalone binary as the shared base. */
export function ensureCodexProfileStandalone(
  profileDir: string,
  baseDir = path.join(os.homedir(), '.codex'),
  sourceOverride?: string
): string {
  const baseExecutable = ensureCodexStandaloneExecutable(baseDir, sourceOverride);
  const profileExecutable = path.join(profileDir, CODEX_STANDALONE_RELATIVE_PATH);
  if (isExecutable(profileExecutable)) return profileExecutable;

  const profilePackages = path.join(profileDir, 'packages');
  if (!pathExists(profilePackages)) {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.symlinkSync(path.join(baseDir, 'packages'), profilePackages, 'dir');
  } else if (fs.lstatSync(profilePackages).isSymbolicLink()) {
    const target = fs.realpathSync(profilePackages);
    if (target !== fs.realpathSync(path.join(baseDir, 'packages'))) {
      throw new Error(
        `Codex profile packages symlink points to an unexpected path: ${profilePackages}`
      );
    }
  } else {
    ensureSymlink(baseExecutable, profileExecutable);
  }
  return profileExecutable;
}

export { CODEX_STANDALONE_RELATIVE_PATH };
