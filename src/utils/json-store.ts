import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';

export interface JsonStoreOptions {
  envVar: string;
  defaultPath: string;
  migrate?: () => void;
}

export interface JsonStore<T> {
  load(): T;
  save(data: T): void;
  getPath(): string;
  transaction<R>(operation: () => R): R;
}

export function createJsonStore<T>(options: JsonStoreOptions): JsonStore<T> {
  let locked = false;
  function transaction<R>(operation: () => R): R {
    if (locked) return operation();
    const file = getPath(),
      lock = `${file}.lock`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const deadline = performance.now() + 1000;
    for (;;) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (performance.now() >= deadline)
          throw new Error(
            `State store busy: ${file}; inspect its .lock directory before retrying.`
          );
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    locked = true;
    try {
      return operation();
    } finally {
      locked = false;
      fs.rmdirSync(lock);
    }
  }
  function getPath(): string {
    if (!process.env[options.envVar]) {
      options.migrate?.();
    }
    return process.env[options.envVar] || options.defaultPath;
  }

  function load(): T {
    try {
      const filePath = getPath();
      if (!fs.existsSync(filePath)) {
        return {} as T;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      if (locked) throw error;
      return {} as T;
    }
  }

  function save(data: T): void {
    if (!locked) {
      try {
        transaction(() => save(data));
      } catch {
        /* Standalone legacy saves remain best effort. */
      }
      return;
    }
    const filePath = getPath();
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        flag: 'wx',
        mode: fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600,
      });
      fs.renameSync(temporary, filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  return { load, save, getPath, transaction };
}
