import { useTestEnv } from './test-utils';
import fs from 'node:fs';
import type { SessionEntry } from '../src/commands/sessions';
import type { ControllerInfo } from '../src/commands/session-ipc';

jest.mock('node:child_process', () => ({
  execFile: jest.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout: 'codex v-test\n', stderr: '' });
    }
  ),
}));

jest.mock('../src/commands/sessions', () => ({
  findSessionByKey: jest.fn(),
  isControllerReachable: jest.fn(),
  loadSessions: jest.fn(),
}));

jest.mock('../src/commands/session-ipc', () => ({
  fetchControllerInfo: jest.fn(),
  sendControllerRequest: jest.fn(),
}));

jest.mock('../src/runtime/procfs', () => ({
  collectProcessTree: jest.fn(),
  listProcEntries: jest.fn(),
}));

import { statusCommand, parseStatusInterval } from '../src/commands/status';
import { findSessionByKey, isControllerReachable, loadSessions } from '../src/commands/sessions';
import { fetchControllerInfo, sendControllerRequest } from '../src/commands/session-ipc';
import { collectProcessTree, listProcEntries } from '../src/runtime/procfs';

const testEnv = useTestEnv();
const mockedFind = jest.mocked(findSessionByKey);
const mockedReachable = jest.mocked(isControllerReachable);
const mockedLoad = jest.mocked(loadSessions);
const mockedInfo = jest.mocked(fetchControllerInfo);
const mockedRequest = jest.mocked(sendControllerRequest);
const mockedTree = jest.mocked(collectProcessTree);
const mockedEntries = jest.mocked(listProcEntries);

function session(
  key: string,
  profile = 'codex',
  overrides: Partial<SessionEntry> = {}
): SessionEntry {
  return {
    id: `${key}-id`,
    profile,
    lastUsed: 1000,
    sessionKey: key,
    cwd: '/tmp/project',
    controllerEndpoint: `/tmp/${key}.sock`,
    profileSessionId: 'native-session',
    startedAt: 1000,
    runtimeId: `${key}-runtime`,
    controllerPid: 101,
    harnessPid: 202,
    runtimeState: 'running',
    ...overrides,
  };
}

function info(overrides: Partial<ControllerInfo> = {}): ControllerInfo {
  return {
    airelayVersion: '0.1.146',
    controllerProtocolVersion: 3,
    startedAt: 1000,
    state: 'busy',
    activityReason: 'recent_io',
    lastInputAt: 2000,
    lastOutputAt: 3000,
    lastActivityAt: 3000,
    quietForMs: 250,
    attached: 1,
    runtime: {
      runtimeId: 'runtime-1',
      controllerPid: 101,
      harnessPid: 202,
      runtimeState: 'running',
    },
    buffers: {
      attachedClients: 1,
      rawRingBytes: 512,
      rawRingChunks: 2,
      outputBufferLines: 10,
      snapshotBufferLines: 20,
    },
    ...overrides,
  };
}

function readJsonLog<T>(): T {
  const log = console.log as jest.Mock;
  return JSON.parse(String(log.mock.calls[0][0])) as T;
}

describe('airelay status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AIRELAY_CONFIG = testEnv.configPath;
    delete process.env.AIRELAY_SESSION_KEY;
    fs.writeFileSync(
      testEnv.configPath,
      `version: 1\nprofiles:\n  codex:\n    executable: codex\n`
    );
    mockedRequest.mockResolvedValue({ type: 'success' });
    mockedInfo.mockResolvedValue(info());
    mockedEntries.mockReturnValue([
      { pid: 101, ppid: 1, rssBytes: 10_000 },
      { pid: 202, ppid: 101, rssBytes: 20_000 },
    ]);
    mockedTree.mockReturnValue({ rootRssBytes: 20_000, treeRssBytes: 20_000, processCount: 1 });
    mockedFind.mockImplementation((key) => {
      const found =
        key === 'explicit'
          ? session('explicit')
          : key === 'env-key'
            ? session('env-key')
            : key === 'watched'
              ? session('watched')
              : null;
      return found ? { profile: found.profile, session: found } : null;
    });
    mockedLoad.mockReturnValue({});
    mockedReachable.mockResolvedValue(false);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses an explicit key before the environment key', async () => {
    process.env.AIRELAY_SESSION_KEY = 'env-key';
    await expect(statusCommand('explicit', { json: true })).resolves.toBe(0);
    expect(readJsonLog<{ session: { key: string } }>()).toMatchObject({
      session: { key: 'explicit' },
    });
  });

  it('uses AIRELAY_SESSION_KEY when no explicit key is supplied', async () => {
    process.env.AIRELAY_SESSION_KEY = 'env-key';
    await expect(statusCommand(undefined, { json: true })).resolves.toBe(0);
    expect(readJsonLog<{ session: { key: string } }>()).toMatchObject({
      session: { key: 'env-key' },
    });
  });

  it('auto-selects exactly one reachable registry session', async () => {
    const live = session('live-key');
    mockedLoad.mockReturnValue({ codex: [live] });
    mockedReachable.mockResolvedValue(true);
    mockedFind.mockReturnValue(null);

    await expect(statusCommand(undefined, { json: true })).resolves.toBe(0);
    expect(readJsonLog<{ session: { key: string } }>()).toMatchObject({
      session: { key: 'live-key' },
    });
  });

  it('does not guess when multiple live sessions exist', async () => {
    const first = session('first');
    const second = session('second', 'opencode');
    mockedLoad.mockReturnValue({ codex: [first], opencode: [second] });
    mockedFind.mockReturnValue(null);
    mockedReachable.mockResolvedValue(true);

    await expect(statusCommand(undefined, { json: true })).resolves.toBe(1);
    expect(readJsonLog<{ error: string; candidates: unknown[] }>()).toMatchObject({
      error: 'ambiguous',
      candidates: [
        { sessionKey: 'first', profile: 'codex' },
        { sessionKey: 'second', profile: 'opencode' },
      ],
    });
    expect(mockedInfo).not.toHaveBeenCalled();
  });

  it('reports clearly when there are no live sessions to select', async () => {
    mockedFind.mockReturnValue(null);
    mockedLoad.mockReturnValue({ codex: [session('stopped')] });
    mockedReachable.mockResolvedValue(false);

    await expect(statusCommand(undefined, { json: true })).resolves.toBe(1);
    expect(readJsonLog<{ error: string }>()).toMatchObject({ error: 'no_live_sessions' });
    expect(mockedInfo).not.toHaveBeenCalled();
  });

  it('reports hibernated sessions without a harness process', async () => {
    const hibernated = session('hibernated', 'codex', {
      harnessPid: null,
      runtimeState: 'hibernated',
    });
    mockedFind.mockReturnValue({ profile: 'codex', session: hibernated });
    mockedInfo.mockResolvedValue(
      info({
        runtime: {
          runtimeId: 'runtime-h',
          controllerPid: 101,
          harnessPid: null,
          runtimeState: 'hibernated',
        },
        state: 'idle',
        activityReason: 'idle',
        attached: 0,
        buffers: {
          attachedClients: 0,
          rawRingBytes: 0,
          rawRingChunks: 0,
          outputBufferLines: 0,
          snapshotBufferLines: 0,
        },
      })
    );

    await expect(statusCommand('hibernated', { json: true })).resolves.toBe(0);
    const result = readJsonLog<{
      session: { state: string; activity: { reason: string } };
      runtime: { health: string; harnessPid: number | null };
      processes: { harness: unknown; bundleRssBytes: number | null };
    }>();
    expect(result).toMatchObject({
      session: { state: 'hibernated', activity: { reason: 'idle' } },
      runtime: { health: 'healthy', harnessPid: null },
      processes: { harness: null, bundleRssBytes: 10_000 },
    });
    expect(mockedTree).not.toHaveBeenCalled();
  });

  it('includes activity, buffers, versions and a human-readable view', async () => {
    mockedFind.mockReturnValue({ profile: 'codex', session: session('human') });
    await expect(statusCommand('human')).resolves.toBe(0);
    const output = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(output).toContain('activity reason  recent_io');
    expect(output).toContain('last output      3000');
    expect(output).toContain('raw ring         512 B / 2 chunks');
    expect(output).toContain('Harness tree');
  });

  it('parses bounded watch intervals', () => {
    expect(parseStatusInterval('1s')).toBe(1000);
    expect(parseStatusInterval('250ms')).toBe(250);
    expect(parseStatusInterval('2m')).toBe(120_000);
    expect(parseStatusInterval('0s')).toBeUndefined();
    expect(parseStatusInterval('fast')).toBeUndefined();
  });

  it('stops watch cleanly on SIGINT', async () => {
    mockedFind.mockReturnValue({ profile: 'codex', session: session('watched') });
    let snapshots = 0;
    (console.log as jest.Mock).mockImplementation(() => {
      snapshots += 1;
      if (snapshots === 2) process.emit('SIGINT');
    });

    await expect(
      statusCommand('watched', { json: true, watch: true, intervalMs: 1 })
    ).resolves.toBe(0);
    expect(snapshots).toBe(2);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });
});
