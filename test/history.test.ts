import fs from 'fs';
import {
  historyCommand,
  historyHelpCommand,
  getLaunchHistory,
  removeHistoryCommand,
  removeLaunchHistory,
  recordLaunchHistory,
  renderLaunchCommand,
  markLaunchHistoryUsed,
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

  it('lists only commands invoked from the current directory by default', () => {
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

    historyCommand();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('current_key'));
    expect(console.log).toHaveBeenCalledWith('> airelay start worker --key current_key');
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('started:'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('other_key'));
  });

  it('lists all directories with --all', () => {
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

    historyCommand({ all: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('current_key'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('other_key'));
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

  it('keeps every launch as a separate history row', () => {
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'unique_key',
      invocationCwd: '/tmp/first-project',
      argv: ['start', 'worker', '--key', 'unique_key'],
      startedAt: 700,
    });
    recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'unique_key',
      invocationCwd: '/tmp/second-project',
      argv: ['start', 'worker', '--key', 'unique_key', '--', '--new'],
      startedAt: 800,
    });

    expect(getLaunchHistory()).toHaveLength(2);
    expect(getLaunchHistory()[0]).toMatchObject({
      sessionKey: 'unique_key',
      invocationCwd: '/tmp/second-project',
      argv: ['start', 'worker', '--key', 'unique_key', '--', '--new'],
    });
  });

  it('removes exact duplicate launches and keeps the freshest row', () => {
    const older = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'same_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'same_key', '--', 'resume', 'same-session'],
      startedAt: 100,
    });
    const newer = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'same_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'same_key', '--', 'resume', 'same-session'],
      startedAt: 200,
    });

    expect(getLaunchHistory()).toEqual([newer]);
    expect(JSON.parse(fs.readFileSync(testEnv.historyPath, 'utf8'))).toEqual([newer]);
    expect(older.id).not.toBe(newer.id);
  });

  it('cleans exact duplicates already stored in history', () => {
    const older = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'stored_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'stored_key', '--', 'resume', 'stored-session'],
      startedAt: 100,
    });
    const newer = {
      ...older,
      id: 'newer-stored-entry',
      startedAt: 200,
      lastUsed: 300,
    };
    fs.writeFileSync(testEnv.historyPath, JSON.stringify([older, newer]), 'utf8');

    expect(getLaunchHistory()).toEqual([newer]);
    expect(JSON.parse(fs.readFileSync(testEnv.historyPath, 'utf8'))).toEqual([newer]);
  });

  it('updates last-used time for one launch row only', () => {
    const first = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'same_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'same_key', '--', 'resume', 'first-session'],
      startedAt: 100,
    });
    const second = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'same_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'same_key', '--', 'resume', 'second-session'],
      startedAt: 200,
    });

    expect(markLaunchHistoryUsed(first.id, 300)).toBe(true);
    expect(getLaunchHistory()).toEqual([
      expect.objectContaining({ id: first.id, lastUsed: 300 }),
      expect.objectContaining({ id: second.id }),
    ]);
  });

  it('records a switched profile without changing the saved harness arguments', () => {
    const entry = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'switch_key',
      invocationCwd: process.cwd(),
      argv: ['start', 'worker', '--key', 'switch_key', '--', 'resume', 'switch-session'],
      startedAt: 100,
    });

    expect(markLaunchHistoryUsed(entry.id, 200, 'worker-alt')).toBe(true);
    expect(getLaunchHistory()).toEqual([
      expect.objectContaining({
        profile: 'worker-alt',
        lastUsed: 200,
        argv: ['start', 'worker-alt', '--key', 'switch_key', '--', 'resume', 'switch-session'],
        command: 'airelay start worker-alt --key switch_key -- resume switch-session',
      }),
    ]);
  });

  it('preserves legacy rows with duplicate session keys', () => {
    const older = recordLaunchHistory({
      profile: 'worker',
      sessionKey: 'legacy_key',
      invocationCwd: '/tmp/old-project',
      argv: ['start', 'worker', '--key', 'legacy_key'],
      startedAt: 900,
    });
    const newer = {
      ...older,
      id: 'newer-entry',
      invocationCwd: '/tmp/new-project',
      startedAt: 1000,
      argv: ['start', 'worker', '--key', 'legacy_key', '--', '-s', 'ses_new'],
      command: 'airelay start worker --key legacy_key -- -s ses_new',
    };
    fs.writeFileSync(testEnv.historyPath, JSON.stringify([older, newer]), 'utf8');

    expect(getLaunchHistory()).toEqual([newer, older]);
    expect(JSON.parse(fs.readFileSync(testEnv.historyPath, 'utf8'))).toEqual([older, newer]);
  });

  it('shows history-specific help', () => {
    historyHelpCommand();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('airelay history'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('history remove <key>'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('separate launch rows'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Exact duplicate launches'));
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
      sessionKey: 'other_key',
      invocationCwd: '/tmp/other-project',
      argv: ['start', 'worker', '--key', 'other_key'],
      startedAt: 600,
    });

    expect(removeLaunchHistory('remove_key')).toBe(1);
    expect(getLaunchHistory()).toHaveLength(1);
    expect(getLaunchHistory()[0].sessionKey).toBe('other_key');

    removeHistoryCommand('missing_key');
    expect(console.log).toHaveBeenCalledWith(
      'No history entry found for key "missing_key" in the current directory.'
    );
  });
});
