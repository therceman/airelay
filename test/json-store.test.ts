import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { createJsonStore } from '../src/utils/json-store';
import { useTestEnv } from './test-utils';

const env = useTestEnv();

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
