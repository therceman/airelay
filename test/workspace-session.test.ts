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
import { startDetachedCommand } from '../src/commands/detached';
import { useTestEnv } from './test-utils';

const env = useTestEnv();
let directory: string, root: string;
let index = 0;
beforeEach(() => {
  directory = path.join(env.testDir, `binding-${index++}`);
  fs.mkdirSync(directory);
  root = path.join(directory, 'workspaces');
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
function agentWorkspace(selector = 'rsg.lead') {
  const parts = selector.split('.');
  provisionWorkspace({
    project: parts[0],
    agent: parts[parts.length - 1],
    root,
  });
  return resolveSessionWorkspace(selector, root);
}

it('resolves public project.agent selectors to independent agent directories', () => {
  const first = agentWorkspace('bb_splunk.worker1'),
    second = agentWorkspace('bb_splunk.worker2');
  expect(first.path).toBe(path.join(root, 'bb_splunk/agents/worker1'));
  expect(second.path).toBe(path.join(root, 'bb_splunk/agents/worker2'));
  expect(fs.lstatSync(path.join(first.path, 'AGENTS.md')).isSymbolicLink()).toBe(false);
  expect(listWorkspaces(root).map((w) => w.selector)).toEqual([
    'bb_splunk.worker1',
    'bb_splunk.worker2',
  ]);
});

it.each(['../lead', 'rsg..lead', 'rsg/agents/lead', '.rsg.lead', 'rsg.lead.', 'rsg'])(
  'rejects unsafe or ambiguous selector %s',
  (selector) => {
    expect(() => selectorPath(selector, root)).toThrow('Invalid workspace selector');
  }
);

it('rejects missing manifests, escaping symlinks and allows agent-owned instructions', () => {
  const workspace = agentWorkspace();
  expect(() => resolveSessionWorkspace('rsg.missing', root)).toThrow();
  fs.symlinkSync(workspace.path, path.join(root, 'rsg/agents/alias'));
  expect(() => resolveSessionWorkspace('rsg.alias', root)).toThrow('symlink');
  fs.writeFileSync(path.join(workspace.path, 'AGENTS.md'), 'modified');
  expect(() => verifySessionWorkspace(workspace)).not.toThrow();
});

it('keeps saved absolute binding stable after global root changes and refuses a different saved path', () => {
  const workspace = agentWorkspace();
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

it('never redirects a saved flat Workspace path even if a new agent has the same public selector', () => {
  const workspace = agentWorkspace();
  expect(() => verifySessionWorkspace({ ...workspace, path: path.join(root, 'rsg/lead') })).toThrow(
    'Invalid saved workspace path'
  );
});

it('preserves immutable key binding after runtime exit and liveness pruning', async () => {
  const workspace = agentWorkspace(),
    other = agentWorkspace('rsg.worker');
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
  const workspace = agentWorkspace();
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

async function waitUntil(check: () => Promise<boolean>, timeout = 15000): Promise<void> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Disposable workspace fixture did not reach the expected state.');
}

it('isolates two concurrent devin sessions through hibernate, independent wake, root change and restart', async () => {
  const first = agentWorkspace('rsg.lead'),
    second = agentWorkspace('bb_splunk.worker');
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
    start('agent-one', first, 'native-one');
    start('agent-two', second, 'native-two');
    await waitUntil(
      async () =>
        endpoints.size === 2 &&
        (await info('agent-one')).runtime?.runtimeState === 'hibernated' &&
        (await info('agent-two')).runtime?.runtimeState === 'hibernated'
    );
    expect(getSessionBindingEntries().filter((s) => s.workspace)).toHaveLength(2);
    writeConfig(path.join(directory, 'new-global-root'));
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(endpoints.get('agent-one')!);
      socket.once('error', reject);
      socket.once('connect', () =>
        socket.end(
          JSON.stringify({ id: 'wake-one', method: 'session.input.raw', params: { data: ' ' } }) +
            '\n',
          resolve
        )
      );
    });
    await waitUntil(async () => (await info('agent-one')).runtime?.runtimeState === 'running');
    await waitUntil(async () => launchRecords().filter((r) => r.key === 'agent-one').length === 2);
    expect((await info('agent-two')).runtime?.runtimeState).toBe('hibernated');
    expect((await info('agent-one')).runtime?.workspace).toEqual(first);
    await stop('agent-one');
    await expect(runtimes[0]).resolves.toBe(0);
    expect(findSessionByKey('agent-one')?.session.workspace).toEqual(first);
    const restarted = start(
      'agent-one',
      findSessionByKey('agent-one')!.session.workspace!,
      'native-one'
    );
    await waitUntil(async () => (await info('agent-one')).runtime?.runtimeState === 'running');
    await waitUntil(async () => launchRecords().filter((r) => r.key === 'agent-one').length === 3);
    await stop('agent-one');
    await restarted;
    const records = fs
      .readFileSync(launches, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.filter((r) => r.key === 'agent-one')).toHaveLength(3);
    expect(records.filter((r) => r.key === 'agent-two')).toHaveLength(1);
    for (const record of records) {
      expect(record.cwd).toBe(record.key === 'agent-one' ? first.path : second.path);
      expect(record.args).toEqual([
        '--resume',
        record.key === 'agent-one' ? 'native-one' : 'native-two',
      ]);
    }
  } finally {
    await stop('agent-one');
    await stop('agent-two');
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
  const first = agentWorkspace('rsg.lead'),
    second = agentWorkspace('bb_splunk.worker');
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
  agentWorkspace();
  expect(() => selectorPath('rsg.lead.nested', root)).toThrow('Invalid workspace selector');
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
  const workspace = agentWorkspace();
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
  const first = agentWorkspace('rsg.lead'),
    second = agentWorkspace('rsg.worker');
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
  const workspace = agentWorkspace();
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
    const workspace = agentWorkspace();
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
