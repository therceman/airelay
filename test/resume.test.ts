import { getResumableProjectPaths, resumeCommand } from '../src/commands/resume';
import { runCommand } from '../src/commands/run';
import { pruneStaleSessions } from '../src/commands/sessions';
import path from 'path';

jest.mock('../src/commands/run', () => ({
  runCommand: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/commands/sessions', () => ({
  findSessionByKey: jest.fn(),
  getSessions: jest.fn(),
  pruneStaleSessions: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/commands/history', () => ({
  getLaunchHistory: jest.fn(),
  markLaunchHistoryUsed: jest.fn(),
}));

jest.mock('../src/config/load', () => ({
  loadConfig: jest.fn(() => ({
    profiles: {
      testprofile: { executable: 'opencode' },
    },
  })),
}));

// Enquirer is used by the profile→session selector path
jest.mock('enquirer', () => ({
  prompt: jest.fn().mockResolvedValue({ session: 'ses_abc' }),
}));

import { findSessionByKey } from '../src/commands/sessions';
import { getLaunchHistory, markLaunchHistoryUsed } from '../src/commands/history';
import Enquirer from 'enquirer';

const originalExit = process.exit;
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  process.exit = jest.fn() as never;
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  jest.clearAllMocks();
});

afterEach(() => {
  process.exit = originalExit;
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
});

describe('resumeCommand', () => {
  it('returns unique resumable projects in recent-use order', () => {
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'project-b-new',
        invocationCwd: '/tmp/project-b',
        startedAt: 300,
        argv: ['start', 'codex', '--', 'resume', 'session-b'],
      },
      {
        id: 'project-a',
        invocationCwd: '/tmp/project-a',
        startedAt: 200,
        argv: ['start', 'codex', 'resume', 'session-a'],
      },
      {
        id: 'project-b-old',
        invocationCwd: '/tmp/project-b',
        startedAt: 100,
        argv: ['start', 'codex', '--', 'resume', 'session-b-old'],
      },
    ]);

    expect(getResumableProjectPaths()).toEqual([
      path.resolve('/tmp/project-b'),
      path.resolve('/tmp/project-a'),
    ]);
  });

  it('launches prompt-capable (usePty: true) with sessionKey and profileArgs', async () => {
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_abcdef',
        sessionKey: 'myprofile_abcd',
        profileSessionId: 'ses_original',
        profileArgs: ['-s', 'ses_original'],
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_abcd');

    expect(runCommand).toHaveBeenCalledWith(
      'testprofile',
      ['-s', 'ses_original'],
      expect.objectContaining({
        usePty: true,
        sessionKey: 'myprofile_abcd',
        profileSessionId: 'ses_original',
        profileArgs: ['-s', 'ses_original'],
      })
    );
  });

  it('uses recorded profileArgs when available', async () => {
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_abcdef',
        sessionKey: 'myprofile_abcd',
        profileSessionId: 'ses_xyz',
        profileArgs: ['-s', 'ses_xyz', '--verbose'],
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_abcd');

    expect(runCommand).toHaveBeenCalledWith(
      'testprofile',
      ['-s', 'ses_xyz', '--verbose'],
      expect.objectContaining({ usePty: true })
    );
  });

  it('legacy metadata fallback uses internal id when no profileArgs', async () => {
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_fallback',
        sessionKey: 'myprofile_fall',
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_fall');

    expect(runCommand).toHaveBeenCalledWith(
      'testprofile',
      ['-s', 'ses_fallback'],
      expect.objectContaining({
        usePty: true,
        sessionKey: 'myprofile_fall',
      })
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no profile session metadata')
    );
  });

  it('does not show warning when profileSessionId is present', async () => {
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_nowarn',
        sessionKey: 'myprofile_warn',
        profileSessionId: 'ses_original',
        profileArgs: ['-s', 'ses_original'],
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_warn');

    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('no profile session metadata')
    );
  });

  it('calls process.exit with runCommand exit code', async () => {
    (runCommand as jest.Mock).mockResolvedValue(42);
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_exit',
        sessionKey: 'myprofile_exit',
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_exit');

    expect(process.exit).toHaveBeenCalledWith(42);
  });

  it('calls pruneStaleSessions before resolving session', async () => {
    (findSessionByKey as jest.Mock).mockReturnValue({
      profile: 'testprofile',
      session: {
        id: 'ses_prune',
        sessionKey: 'myprofile_prune',
        lastUsed: Date.now(),
      },
    });

    await resumeCommand('myprofile_prune');

    expect(pruneStaleSessions).toHaveBeenCalled();
  });

  it('selects the newest resumable launch row from the current folder', async () => {
    const now = 1_000_000_000;
    const currentCwd = process.cwd();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    (getLaunchHistory as jest.Mock).mockReturnValue(
      [
        {
          id: 'newest-row',
          profile: 'codex',
          sessionKey: 'gpt-tunnel-gateway_master',
          invocationCwd: currentCwd,
          startedAt: now - 30 * 60 * 1000,
          argv: [
            'start',
            'codex',
            '--key',
            'gpt-tunnel-gateway_master',
            '--',
            'resume',
            '019faea5-f0b2-73a3-b286-ef54956ddd0f',
            '--dangerously-bypass-approvals-and-sandbox',
          ],
          command: 'airelay start codex --key gpt-tunnel-gateway_master',
        },
        {
          id: 'older-row',
          profile: 'codex2',
          sessionKey: 'gpt-tunnel-gateway_master',
          invocationCwd: currentCwd,
          startedAt: now - 12 * 60 * 60 * 1000,
          argv: [
            'start',
            'codex2',
            '--key',
            'gpt-tunnel-gateway_master',
            '--',
            'resume',
            '023fae12-f3b2-75a3-b255-ef54556xxxav',
            '--dangerously-bypass-approvals-and-sandbox',
          ],
          command: 'airelay start codex2 --key gpt-tunnel-gateway_master',
        },
      ].reverse()
    );
    (Enquirer.prompt as jest.Mock).mockResolvedValueOnce({ historyEntry: 'newest-row' });

    await resumeCommand();

    const prompt = (Enquirer.prompt as jest.Mock).mock.calls[0][0];
    expect(prompt.choices).toEqual([
      {
        name: 'newest-row',
        message: expect.stringContaining('[30m ago] codex ('),
      },
      {
        name: 'older-row',
        message: expect.stringContaining('[12h ago] codex2 ('),
      },
    ]);
    expect(prompt.choices[0].message).toContain('[30m ago] codex (gpt-tunnel-gateway_master)');
    expect(prompt.choices[0].message).toContain(
      '-- resume 019faea5-f0b2-73a3-b286-ef54956ddd0f --dangerously-bypass-approvals-and-sandbox'
    );
    expect(runCommand).toHaveBeenCalledWith(
      'codex',
      [
        'resume',
        '019faea5-f0b2-73a3-b286-ef54956ddd0f',
        '--dangerously-bypass-approvals-and-sandbox',
      ],
      expect.objectContaining({
        cwd: currentCwd,
        sessionKey: 'gpt-tunnel-gateway_master',
        usePty: true,
      })
    );
    expect(markLaunchHistoryUsed).toHaveBeenCalledWith('newest-row');
    jest.restoreAllMocks();
  });
});
