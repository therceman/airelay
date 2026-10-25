import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { provisionWorkspace, selectorPath } from '../src/workspace/provision';
import {
  resolveSessionWorkspace,
  verifySessionWorkspace,
  listWorkspaces,
  assertWorkspaceBinding,
} from '../src/workspace/binding';
import { buildProfileEnv, runCommand } from '../src/commands/run';
import {
  addSession,
  finalizeSessionRuntime,
  findSessionByKey,
  getSessionBindingEntries,
  pruneStaleSessions,
} from '../src/commands/sessions';
import { recordLaunchHistory, getLaunchHistory } from '../src/commands/history';
import { fetchControllerInfo, sendControllerRequest } from '../src/commands/session-ipc';
import { migrateWorkspaceProfiles } from '../src/workspace/migrate-profiles';
import { loadConfig } from '../src/config/load';
import { startDetachedCommand } from '../src/commands/detached';
import { useTestEnv } from './test-utils';

const env = useTestEnv();
let directory: string, root: string, instructions: string;
let index = 0;
beforeEach(() => {
  directory = path.join(env.testDir, `binding-${index++}`);
  fs.mkdirSync(directory);
  root = path.join(directory, 'workspaces');
  instructions = path.join(directory, 'instructions.md');
  fs.writeFileSync(instructions, '# Canonical role\n');
  for (const file of [env.sessionsPath, env.historyPath, env.detachedPath])
    fs.rmSync(file, { force: true });
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: root },
      profiles: { devin: { executable: 'devin' } },
    })
  );
});
function role(selector = 'rsg.lead') {
  const parts = selector.split('.');
  provisionWorkspace({
    project: parts[0],
    role: parts[parts.length - 1],
    root,
    selector,
    instructions,
  });
  return resolveSessionWorkspace(selector, root);
}

it('resolves dot paths and shares canonical Role assets with regular per-agent identity files', () => {
  const canonical = role('bb_splunk.roles.worker');
  provisionWorkspace({
    project: 'bb_splunk',
    role: 'worker',
    instance: 'worker1',
    selector: 'bb_splunk.agents.worker1',
    roleSelector: canonical.selector,
    root,
  });
  const worker = resolveSessionWorkspace('bb_splunk.agents.worker1', root);
  expect(worker.path).toBe(path.join(root, 'bb_splunk/agents/worker1'));
  expect(fs.realpathSync(path.join(worker.path, 'AGENTS.md'))).toBe(
    path.join(canonical.path, 'AGENTS.md')
  );
  expect(
    fs.lstatSync(path.join(worker.path, '.devin/mcp_config.local.json')).isSymbolicLink()
  ).toBe(false);
  expect(listWorkspaces(root).map((w) => w.selector)).toEqual([
    'bb_splunk.agents.worker1',
    'bb_splunk.roles.worker',
  ]);
});

it.each(['../lead', 'rsg..lead', 'rsg/lead', '.rsg.lead', 'rsg.lead.', 'rsg'])(
  'rejects unsafe or ambiguous selector %s',
  (selector) => {
    expect(() => selectorPath(selector, root)).toThrow('Invalid workspace selector');
  }
);

it('rejects missing manifests, escaping symlinks and altered Role assets', () => {
  const workspace = role();
  expect(() => resolveSessionWorkspace('rsg.missing', root)).toThrow();
  fs.symlinkSync(workspace.path, path.join(root, 'rsg/alias'));
  expect(() => resolveSessionWorkspace('rsg.alias', root)).toThrow('symlink');
  fs.writeFileSync(path.join(workspace.path, 'AGENTS.md'), 'modified');
  expect(() => verifySessionWorkspace(workspace)).toThrow();
});

it('keeps saved absolute binding stable after global root changes and refuses a different saved path', () => {
  const workspace = role();
  const replacement = path.join(directory, 'different-root');
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: replacement },
      profiles: { devin: { executable: 'devin' } },
    })
  );
  expect(buildProfileEnv('devin', [], undefined, undefined, false, workspace).cwd).toBe(
    workspace.path
  );
  expect(() =>
    buildProfileEnv('devin', [], undefined, undefined, false, workspace.selector)
  ).toThrow();
  expect(() => verifySessionWorkspace({ ...workspace, path: directory })).toThrow(
    'Invalid saved workspace'
  );
});

it('preserves immutable key binding after runtime exit and liveness pruning', async () => {
  const workspace = role(),
    other = role('rsg.worker');
  addSession(
    'devin',
    'old-runtime',
    workspace.path,
    'bound-key',
    undefined,
    2147483647,
    undefined,
    undefined,
    undefined,
    'native-id',
    ['--resume', 'native-id'],
    workspace
  );
  expect(await pruneStaleSessions()).toBe(1);
  expect(findSessionByKey('bound-key')?.session.workspace).toEqual(workspace);
  expect(() =>
    addSession(
      'devin',
      'new-runtime',
      other.path,
      'bound-key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      other
    )
  ).toThrow('different Workspace');
  expect(() => addSession('devin', 'new-runtime', directory, 'bound-key')).toThrow(
    'different Workspace'
  );
  finalizeSessionRuntime('devin', 'old-runtime');
  expect(findSessionByKey('bound-key')?.session.profileSessionId).toBe('native-id');
});

it('checks history bindings independently of profile and does not reinterpret missing workspace as a match', () => {
  const workspace = role();
  recordLaunchHistory({
    profile: 'devin',
    sessionKey: 'recorded',
    invocationCwd: directory,
    argv: ['start', 'devin'],
    workspace,
  });
  expect(() => assertWorkspaceBinding('recorded', undefined, getLaunchHistory())).toThrow(
    'different Workspace'
  );
  expect(() =>
    recordLaunchHistory({
      profile: 'second',
      sessionKey: 'recorded',
      invocationCwd: directory,
      argv: ['start', 'second'],
    })
  ).toThrow('different Workspace');
});

it('removes only unmodified unused generated profiles with backup and root pinning; dry-run writes nothing', () => {
  role();
  const configuration = {
    version: 1,
    profiles: {
      devin: { executable: 'devin', env: { SAFE: 'preserved' } },
      'workspace-rsg-lead': {
        executable: 'devin',
        cwd: path.join(root, 'rsg/lead'),
        workspace: { project: 'rsg', role: 'lead' },
      },
    },
    settings: { workspaceRoot: root },
  };
  fs.writeFileSync(env.configPath, JSON.stringify(configuration), { mode: 0o600 });
  const before = fs.readFileSync(env.configPath);
  expect(() => loadConfig()).toThrow('migrate-profiles');
  expect(migrateWorkspaceProfiles(true).removed).toEqual(['workspace-rsg-lead']);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
  const result = migrateWorkspaceProfiles(false);
  expect(fs.readFileSync(path.join(result.backup!, '0.backup'))).toEqual(before);
  expect(fs.statSync(result.backup!).mode & 0o777).toBe(0o700);
  expect(loadConfig().profiles).toEqual({
    devin: { executable: 'devin', env: { SAFE: 'preserved' } },
  });
  expect(loadConfig().settings.workspaceRoot).toBe(root);
  expect(fs.existsSync(path.join(root, 'rsg/lead/AGENTS.md'))).toBe(true);
});

it.each(['modified', 'referenced'])(
  'preserves %s generated profiles instead of silently rewriting them',
  (condition) => {
    role();
    const profile = {
      executable: 'devin',
      cwd: path.join(root, 'rsg/lead'),
      workspace: { project: 'rsg', role: 'lead' },
      ...(condition === 'modified' ? { description: 'my edits' } : {}),
    };
    fs.writeFileSync(
      env.configPath,
      JSON.stringify({
        version: 1,
        settings: { workspaceRoot: root },
        profiles: { devin: { executable: 'devin' }, 'workspace-rsg-lead': profile },
      })
    );
    if (condition === 'referenced')
      fs.writeFileSync(env.historyPath, JSON.stringify([{ profile: 'workspace-rsg-lead' }]));
    const before = fs.readFileSync(env.configPath);
    expect(() => migrateWorkspaceProfiles(false)).toThrow(
      condition === 'modified' ? 'modified' : 'references'
    );
    expect(fs.readFileSync(env.configPath)).toEqual(before);
  }
);

async function waitUntil(check: () => Promise<boolean>, timeout = 15000): Promise<void> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Disposable workspace fixture did not reach the expected state.');
}

it('isolates two concurrent devin sessions through hibernate, independent wake, root change and restart', async () => {
  const first = role('rsg.lead'),
    second = role('bb_splunk.worker');
  const binary = path.join(directory, 'devin');
  const launches = path.join(directory, 'launches.jsonl');
  writeNativeFixture(binary, launches);
  const writeConfig = (currentRoot: string) =>
    fs.writeFileSync(
      env.configPath,
      JSON.stringify({
        version: 1,
        settings: { workspaceRoot: currentRoot, hibernateAfter: '1s' },
        profiles: { devin: { executable: binary } },
      })
    );
  writeConfig(root);
  const endpoints = new Map<string, string>();
  const runtimes: Promise<number>[] = [];
  const start = (key: string, workspace: typeof first, native: string) => {
    const runtime = runCommand('devin', ['--resume', native], {
      sessionKey: key,
      workspace,
      detached: true,
      usePty: true,
      recordLaunch: true,
      onSessionStart: (info) => {
        endpoints.set(key, info.controllerEndpoint);
      },
    });
    void runtime.catch(() => undefined);
    runtimes.push(runtime);
    return runtime;
  };
  const info = (key: string) => fetchControllerInfo(endpoints.get(key)!);
  const launchRecords = () =>
    fs.existsSync(launches)
      ? fs
          .readFileSync(launches, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const stop = async (key: string) => {
    if (endpoints.has(key))
      await sendControllerRequest(endpoints.get(key)!, {
        id: 'stop-fixture',
        method: 'session.stop',
      }).catch(() => undefined);
  };
  try {
    start('role-one', first, 'native-one');
    start('role-two', second, 'native-two');
    await waitUntil(
      async () =>
        endpoints.size === 2 &&
        (await info('role-one')).runtime?.runtimeState === 'hibernated' &&
        (await info('role-two')).runtime?.runtimeState === 'hibernated'
    );
    expect(getSessionBindingEntries().filter((s) => s.workspace)).toHaveLength(2);
    writeConfig(path.join(directory, 'new-global-root'));
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(endpoints.get('role-one')!);
      socket.once('error', reject);
      socket.once('connect', () =>
        socket.end(
          JSON.stringify({ id: 'wake-one', method: 'session.input.raw', params: { data: ' ' } }) +
            '\n',
          resolve
        )
      );
    });
    await waitUntil(async () => (await info('role-one')).runtime?.runtimeState === 'running');
    await waitUntil(async () => launchRecords().filter((r) => r.key === 'role-one').length === 2);
    expect((await info('role-two')).runtime?.runtimeState).toBe('hibernated');
    expect((await info('role-one')).runtime?.workspace).toEqual(first);
    await stop('role-one');
    await expect(runtimes[0]).resolves.toBe(0);
    expect(findSessionByKey('role-one')?.session.workspace).toEqual(first);
    const restarted = start(
      'role-one',
      findSessionByKey('role-one')!.session.workspace!,
      'native-one'
    );
    await waitUntil(async () => (await info('role-one')).runtime?.runtimeState === 'running');
    await waitUntil(async () => launchRecords().filter((r) => r.key === 'role-one').length === 3);
    await stop('role-one');
    await restarted;
    const records = fs
      .readFileSync(launches, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.filter((r) => r.key === 'role-one')).toHaveLength(3);
    expect(records.filter((r) => r.key === 'role-two')).toHaveLength(1);
    for (const record of records) {
      expect(record.cwd).toBe(record.key === 'role-one' ? first.path : second.path);
      expect(record.args).toEqual([
        '--resume',
        record.key === 'role-one' ? 'native-one' : 'native-two',
      ]);
    }
  } finally {
    await stop('role-one');
    await stop('role-two');
    await Promise.all(runtimes.map((runtime) => runtime.catch(() => undefined)));
  }
}, 25000);

function writeNativeFixture(binary: string, launches: string): void {
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), cwd = process.cwd();
if (args[0] === 'mcp') console.log('No MCP servers configured.');
else if (args[0] === 'skills') console.log('[]');
else if (args[0] === 'rules') console.log(args[1] === 'list' ? '  AGENTS [Standard] always-on' : fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'));
else { fs.appendFileSync(${JSON.stringify(launches)}, JSON.stringify({key: process.env.AIRELAY_SESSION_KEY, cwd, args}) + '\\n'); process.stdout.write('Ask Devin to build features, fix bugs, or work on your code\\n'); process.stdin.resume(); }
`,
    { mode: 0o755 }
  );
}

it('passes the frozen Workspace through the detached supervisor and refuses key rebinding', async () => {
  const first = role('rsg.lead'),
    second = role('bb_splunk.worker');
  const binary = path.join(directory, 'devin'),
    launches = path.join(directory, 'detached-launches.jsonl');
  writeNativeFixture(binary, launches);
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: root, hibernateAfter: 'off' },
      profiles: { devin: { executable: binary } },
    })
  );
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let endpoint: string | undefined;
  try {
    expect(
      await startDetachedCommand('devin', ['--resume', 'native-detached'], {
        key: 'detached-role',
        workspace: first.selector,
        invocationCwd: directory,
      })
    ).toBe(0);
    endpoint = findSessionByKey('detached-role')!.session.controllerEndpoint;
    expect((await fetchControllerInfo(endpoint!)).runtime?.workspace).toEqual(first);
    await waitUntil(async () => fs.existsSync(launches));
    expect(JSON.parse(fs.readFileSync(launches, 'utf8').trim()).cwd).toBe(first.path);
    expect(
      await startDetachedCommand('devin', [], {
        key: 'detached-role',
        workspace: second.selector,
        invocationCwd: directory,
      })
    ).toBe(1);
    expect(findSessionByKey('detached-role')!.session.workspace).toEqual(first);
  } finally {
    if (endpoint) {
      await sendControllerRequest(endpoint, {
        id: 'stop-disposable-detached',
        method: 'session.stop',
      }).catch(() => undefined);
      await waitUntil(async () => !findSessionByKey('detached-role')?.session.controllerPid);
    }
    log.mockRestore();
    error.mockRestore();
  }
}, 15000);

it('rejects nested managed paths and non-native managed harnesses while leaving unmanaged profiles compatible', () => {
  role();
  expect(() => selectorPath('rsg.lead.nested', root)).toThrow('Nested managed');
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: root },
      profiles: { other: { executable: 'node', cwd: directory } },
    })
  );
  expect(() => buildProfileEnv('other', [], undefined, undefined, false, 'rsg.lead')).toThrow(
    'native devin'
  );
  expect(buildProfileEnv('other', []).cwd).toBe(directory);
});

it('cleans the controller/reservation when launch-history persistence fails before PTY spawn', async () => {
  const workspace = role();
  const binary = path.join(directory, 'devin'),
    launches = path.join(directory, 'never-launched.jsonl');
  writeNativeFixture(binary, launches);
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: root },
      profiles: { devin: { executable: binary } },
    })
  );
  const original = fs.renameSync;
  const failure = jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (destination === env.historyPath) throw new Error('fixture history commit failure');
    original(source, destination);
  });
  let endpoint = '';
  try {
    await expect(
      runCommand('devin', [], {
        workspace,
        usePty: true,
        detached: true,
        sessionKey: 'failed-start',
        recordLaunch: true,
        onSessionStart: (info) => {
          endpoint = info.controllerEndpoint;
        },
      })
    ).rejects.toThrow('fixture history commit failure');
  } finally {
    failure.mockRestore();
  }
  expect(fs.existsSync(launches)).toBe(false);
  expect(fs.existsSync(endpoint)).toBe(false);
  expect(findSessionByKey('failed-start')!.session.controllerPid).toBeUndefined();
  expect(findSessionByKey('failed-start')!.session.workspace).toEqual(workspace);
});

it('rejects a history key rename onto a conflicting inactive Workspace binding', () => {
  const first = role('rsg.lead'),
    second = role('rsg.worker');
  addSession(
    'devin',
    'inactive-worker',
    second.path,
    'reserved-worker',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'native-worker',
    undefined,
    second
  );
  const history = recordLaunchHistory({
    profile: 'devin',
    sessionKey: 'lead-history',
    invocationCwd: directory,
    workspace: first,
    argv: ['start', 'devin', '--key', 'lead-history'],
  });
  const { updateLaunchHistorySessionKey } =
    require('../src/commands/history') as typeof import('../src/commands/history');
  expect(() => updateLaunchHistorySessionKey(history.id, directory, 'reserved-worker')).toThrow(
    'different Workspace'
  );
  expect(getLaunchHistory()[0].sessionKey).toBe('lead-history');
});

it('does not overwrite a syntactically valid but structurally invalid session/history store', () => {
  const workspace = role();
  fs.writeFileSync(env.sessionsPath, '[]');
  expect(() =>
    addSession(
      'devin',
      'runtime',
      workspace.path,
      'bound',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workspace
    )
  ).toThrow('Invalid session registry');
  expect(fs.readFileSync(env.sessionsPath, 'utf8')).toBe('[]');
  fs.rmSync(env.sessionsPath);
  fs.writeFileSync(env.historyPath, '{}');
  expect(() =>
    recordLaunchHistory({
      profile: 'devin',
      sessionKey: 'bound',
      invocationCwd: directory,
      argv: ['start', 'devin'],
      workspace,
    })
  ).toThrow('Invalid launch history');
  expect(fs.readFileSync(env.historyPath, 'utf8')).toBe('{}');
});

it.each([false, true])(
  're-reads after async pruning without losing concurrent metadata (refresh existing=%s)',
  async (refresh) => {
    const workspace = role();
    const endpoint = path.join(directory, 'prune.sock');
    addSession(
      'devin',
      'stale-runtime',
      workspace.path,
      'stale-key',
      endpoint,
      2147483647,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workspace
    );
    const server = net.createServer((socket) =>
      socket.once('data', () => {
        addSession(
          'devin',
          'concurrent-runtime',
          workspace.path,
          'concurrent-key',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          workspace
        );
        if (refresh)
          addSession(
            'devin',
            'stale-runtime',
            workspace.path,
            'stale-key',
            'refreshed-endpoint',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            workspace
          );
        socket.end('{"id":"prune-1","type":"error"}\n');
      })
    );
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    try {
      expect(await pruneStaleSessions()).toBe(refresh ? 0 : 1);
      expect(findSessionByKey('concurrent-key')!.session.workspace).toEqual(workspace);
      expect(findSessionByKey('stale-key')!.session.controllerEndpoint).toBe(
        refresh ? 'refreshed-endpoint' : undefined
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
);
