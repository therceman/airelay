import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlink } from './provision';

interface BackupEntry {
  source: string;
  stored: string;
  mode: number;
  uid: number;
  gid: number;
  sha256?: string;
  link?: string;
}

export function backupWorkspaceConfiguration(files: string[], destination: string): string {
  if (files.length > 256) throw new Error('Configuration backup file limit exceeded.');
  assertNoSymlink(destination);
  const entries: BackupEntry[] = [];
  let bytes = 0;
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const [index, source] of files.entries()) {
    const stat = fs.lstatSync(source);
    if (stat.uid !== process.getuid?.())
      throw new Error('Configuration backup requires user-owned inputs.');
    if (!stat.isFile() && !stat.isSymbolicLink())
      throw new Error('Back up individual configuration files or symlinks, not directories.');
    bytes += stat.size;
    if (bytes > 16 * 1024 * 1024) throw new Error('Configuration backup byte limit exceeded.');
    const entry: BackupEntry = {
      source: path.resolve(source),
      stored: `${index}.backup`,
      mode: stat.mode & 0o777,
      uid: stat.uid,
      gid: stat.gid,
    };
    const target = path.join(destination, entry.stored);
    if (stat.isSymbolicLink()) {
      entry.link = fs.readlinkSync(source);
      // Store the link text as protected data, never follow it into credentials.
      fs.writeFileSync(target, entry.link, { mode: 0o600, flag: 'wx' });
    } else {
      const contents = fs.readFileSync(source);
      entry.sha256 = createHash('sha256').update(contents).digest('hex');
      fs.writeFileSync(target, contents, { mode: entry.mode, flag: 'wx' });
    }
    entries.push(entry);
    fs.writeFileSync(
      path.join(destination, 'manifest.json'),
      JSON.stringify({ version: 1, entries }, null, 2) + '\n',
      { mode: 0o600 }
    );
  }
  return path.join(destination, 'manifest.json');
}

/** Restore only after an operator has reviewed the recorded original paths. */
export function restoreWorkspaceConfiguration(directory: string, sources?: string[]): void {
  assertNoSymlink(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as {
    version: number;
    entries: BackupEntry[];
  };
  if (manifest.version !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length > 256)
    throw new Error('Invalid backup manifest.');
  if (sources) {
    if (sources.some((source) => !manifest.entries.some((entry) => entry.source === source)))
      throw new Error('Requested restore source is not in this backup.');
    manifest.entries = manifest.entries.filter((entry) => sources.includes(entry.source));
  }
  // Validate the complete backup before replacing any original configuration.
  for (const entry of manifest.entries) {
    if (
      !/^[0-9]+\.backup$/.test(entry.stored) ||
      !path.isAbsolute(entry.source) ||
      entry.uid !== process.getuid?.()
    )
      throw new Error('Invalid backup entry.');
    assertNoSymlink(path.dirname(entry.source));
    const file = path.join(directory, entry.stored);
    assertNoSymlink(file);
    if (
      entry.link === undefined &&
      createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256
    )
      throw new Error('Backup hash mismatch.');
    if (entry.link !== undefined && fs.readFileSync(file, 'utf8') !== entry.link)
      throw new Error('Backup link mismatch.');
  }
  for (const entry of manifest.entries) {
    const temporary = `${entry.source}.airelay-restore-${process.pid}.tmp`;
    try {
      if (entry.link !== undefined) fs.symlinkSync(entry.link, temporary);
      else
        fs.writeFileSync(temporary, fs.readFileSync(path.join(directory, entry.stored)), {
          mode: entry.mode,
          flag: 'wx',
        });
      if (entry.link === undefined) fs.chownSync(temporary, entry.uid, entry.gid);
      fs.renameSync(temporary, entry.source);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}
