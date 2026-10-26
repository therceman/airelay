import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { createJsonStore } from '../src/utils/json-store';
import { useTestEnv } from './test-utils';

const env = useTestEnv();

it.each([60000, -60000])(
  'can acquire a briefly held lock despite repeated %ims wall-clock steps',
  (step) => {
    const file = path.join(env.testDir, `brief-clock-${step}.json`);
    const lock = `${file}.lock`;
    const store = createJsonStore<{ ok: boolean }>({
      envVar: 'AIRELAY_STORE_FIXTURE',
      defaultPath: file,
    });
    fs.mkdirSync(lock);
    jest.useFakeTimers({ now: 0 });
    let waits = 0;
    const wait = jest.spyOn(Atomics, 'wait').mockImplementation(() => {
      jest.advanceTimersByTime(10);
      jest.setSystemTime(Date.now() + step);
      if (++waits === 4) fs.rmdirSync(lock);
      return 'timed-out';
    });
    try {
      store.transaction(() => store.save({ ok: true }));
      expect(store.load()).toEqual({ ok: true });
      expect(performance.now()).toBe(40);
      expect(wait).toHaveBeenCalledTimes(4);
      expect(fs.existsSync(lock)).toBe(false);
    } finally {
      wait.mockRestore();
      jest.useRealTimers();
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
);

it.each([60000, -60000])(
  'times out a continuously held lock after 1000ms despite %ims wall-clock steps',
  (step) => {
    const file = path.join(env.testDir, `held-clock-${step}.json`);
    const lock = `${file}.lock`;
    const store = createJsonStore({ envVar: 'AIRELAY_STORE_FIXTURE', defaultPath: file });
    fs.mkdirSync(lock);
    jest.useFakeTimers({ now: 0 });
    let waits = 0;
    const wait = jest.spyOn(Atomics, 'wait').mockImplementation(() => {
      if (++waits > 100) throw new Error('Lock wait exceeded the monotonic deadline.');
      jest.advanceTimersByTime(10);
      jest.setSystemTime(Date.now() + step);
      return 'timed-out';
    });
    const operation = jest.fn();
    try {
      expect(() => store.transaction(operation)).toThrow('State store busy');
      expect(performance.now()).toBe(1000);
      expect(wait).toHaveBeenCalledTimes(100);
      expect(operation).not.toHaveBeenCalled();
      expect(fs.existsSync(lock)).toBe(true);
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      wait.mockRestore();
      jest.useRealTimers();
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
);

it('serializes concurrent read-modify-write transactions from independent processes', async () => {
  const modulePath = path.join(env.testDir, 'json-store.cjs');
  const file = path.join(env.testDir, 'concurrent.json');
  fs.writeFileSync(
    modulePath,
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/utils/json-store.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText
  );
  const script = `const {createJsonStore} = require(${JSON.stringify(modulePath)});
const store = createJsonStore({envVar:'AIRELAY_STORE_FIXTURE',defaultPath:${JSON.stringify(file)}});
for (let i=0;i<25;i++) store.transaction(() => { const value=store.load(); value[process.argv[1]+'-'+i]=true; store.save(value); });`;
  const children = Array.from({ length: 4 }, (_, i) =>
    spawn(process.execPath, ['-e', script, String(i)], {
      env: { ...process.env, AIRELAY_STORE_FIXTURE: file },
      stdio: 'pipe',
    })
  );
  const codes = await Promise.all(
    children.map((child) => new Promise((resolve) => child.on('exit', resolve)))
  );
  expect(codes).toEqual([0, 0, 0, 0]);
  expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))).toHaveLength(100);
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
});

it('releases transaction locks after errors and refuses to overwrite corrupt state', () => {
  const file = path.join(env.testDir, 'failed-store.json');
  const store = createJsonStore<{ value: number }>({
    envVar: 'AIRELAY_STORE_FIXTURE',
    defaultPath: file,
  });
  expect(() =>
    store.transaction(() => {
      throw new Error('abort');
    })
  ).toThrow('abort');
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
  fs.writeFileSync(file, '{broken');
  expect(() =>
    store.transaction(() => {
      store.load();
      store.save({ value: 1 });
    })
  ).toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
});

it('atomically replaces state and cleans temporary files when commit fails', () => {
  const file = path.join(env.testDir, 'atomic-store.json');
  const store = createJsonStore<{ value: number }>({
    envVar: 'AIRELAY_STORE_FIXTURE',
    defaultPath: file,
  });
  store.transaction(() => store.save({ value: 1 }));
  const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw new Error('disk failure');
  });
  try {
    expect(() => store.transaction(() => store.save({ value: 2 }))).toThrow('disk failure');
  } finally {
    rename.mockRestore();
  }
  expect(store.load()).toEqual({ value: 1 });
  expect(
    fs.readdirSync(env.testDir).filter((name) => name.startsWith('atomic-store.json'))
  ).toEqual(['atomic-store.json']);
});
