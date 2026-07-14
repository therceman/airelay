import fs from 'fs';
import {
  historyCommand,
  getLaunchHistory,
  removeHistoryCommand,
  removeLaunchHistory,
  recordLaunchHistory,
  renderLaunchCommand,
} from '../src/commands/history';
import { runCommand } from '../src/commands/run';
import { createTestConfig, useTestEnv } from './test-utils';

const testEnv = useTestEnv();
const originalLog = console.log;

beforeAll(() => {
  createTestConfig(testEnv.configPath, {
    worker: {
      executable: 'node',
      args: ['-e', 'process.exit(0)'],
    },
  });
});

beforeEach(() => {
  console.log = jest.fn();
  if (fs.existsSync(testEnv.historyPath)) {
    fs.unlinkSync(testEnv.historyPath);
  }
});

afterEach(() => {
  console.log = originalLog;
});

describe('launch history', () => {
  it('persists exact argv and renders shell-safe command text', () => {
    const argv = [
      'start',
      'worker',
      '--key',
      'worker_key',
      '--',
      'resume',
      'session-id',
      '--message',
      'text with spaces',
      "quote's value",
    ];
    const entry = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'worker_key',
      invocationCwd: '/tmp/invocation',
      argv,
      startedAt: 100,
    });

    expect(entry.argv).toEqual(argv);
    expect(entry.invocationCwd).toBe('/tmp/invocation');
    expect(entry.command).toBe(
      "airelay start worker --key worker_key -- resume session-id --message 'text with spaces' 'quote'\"'\"'s value'"
    );
    expect(JSON.parse(fs.readFileSync(testEnv.historyPath, 'utf8'))).toEqual([entry]);
  });

  it('lists only commands invoked from the current directory with --cwd', () => {
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'current_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'current_key'],
      startedAt: 200,
    });
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'other_key',
      invocationCwd: '/tmp/other-project',
      argv: ['start', 'worker', '--key', 'other_key'],
      startedAt: 300,
    });

    historyCommand({ cwd: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('current_key'));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('airelay start worker --key current_key')
    );
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('other_key'));
  });

  it('returns structured JSON entries', () => {
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'json_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'json_key'],
      startedAt: 400,
    });

    historyCommand({ json: true });

    const output = (console.log as jest.Mock).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      profile: 'worker',
      sessionKey: 'json_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'json_key'],
      command: 'airelay start worker --key json_key',
      startedAt: 400,
    });
  });

  it('records a start launch independently of active session cleanup', async () => {
    const exitCode = await runCommand('worker', [], {
      recordLaunch: true,
      invocationCwd: '/tmp/caller-project',
      launchArgv: ['start', 'worker', '--key', 'persisted_key', '--', '--flag'],
      sessionKey: 'persisted_key',
    });

    expect(exitCode).toBe(0);
    expect(getLaunchHistory()).toHaveLength(1);
    expect(getLaunchHistory()[0]).toMatchObject({
      sessionKey: 'persisted_key',
      invocationCwd: '/tmp/caller-project',
      argv: ['start', 'worker', '--key', 'persisted_key', '--', '--flag'],
    });
  });

  it('quotes empty arguments and preserves the command prefix', () => {
    expect(renderLaunchCommand(['start', 'worker', '--', ''])).toBe("airelay start worker -- ''");
  });

  it('removes matching entries only from the current invocation directory', () => {
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'remove_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'remove_key'],
      startedAt: 500,
    });
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'remove_key',
      invocationCwd: '/tmp/other-project',
      argv: ['start', 'worker', '--key', 'remove_key'],
      startedAt: 600,
    });

    expect(removeLaunchHistory('remove_key')).toBe(1);
    expect(getLaunchHistory()).toHaveLength(1);
    expect(getLaunchHistory()[0].invocationCwd).toBe('/tmp/other-project');

    removeHistoryCommand('missing_key');
    expect(console.log).toHaveBeenCalledWith(
      'No history entry found for key "missing_key" in the current directory.'
    );
  });
});
