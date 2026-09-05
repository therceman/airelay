import {
  hasSwitchableLastSession,
  getResumableProjectPaths,
  getResumableProjects,
  resumeCommand,
  switchLastSessionProfile,
} from '../src/commands/resume';
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

import { findSessionByKey, getSessions } from '../src/commands/sessions';
import { getLaunchHistory, markLaunchHistoryUsed } from '../src/commands/history';
import { loadConfig } from '../src/config/load';
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
  (getSessions as jest.Mock).mockReturnValue([]);
  (loadConfig as jest.Mock).mockReturnValue({
    profiles: {
      testprofile: { executable: 'opencode' },
    },
  });
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

  it('returns each project with its newest resumable launch time', () => {
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'project-a-old',
        invocationCwd: '/tmp/project-a',
        startedAt: 100,
        lastUsed: 200,
        argv: ['start', 'codex', '--', 'resume', 'session-a-old'],
      },
      {
        id: 'project-b',
        invocationCwd: '/tmp/project-b',
        startedAt: 300,
        argv: ['start', 'codex', '--', 'resume', 'session-b'],
      },
      {
        id: 'project-a-new',
        invocationCwd: '/tmp/project-a',
        startedAt: 400,
        argv: ['start', 'codex', '--', 'resume', 'session-a-new'],
      },
    ]);

    expect(getResumableProjects()).toEqual([
      { path: path.resolve('/tmp/project-a'), lastUsed: 400 },
      { path: path.resolve('/tmp/project-b'), lastUsed: 300 },
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
    (Enquirer.prompt as jest.Mock).mockResolvedValueOnce({
      historyEntry: 'codex (gpt-tunnel-gateway_master)',
    });

    await resumeCommand();

    const prompt = (Enquirer.prompt as jest.Mock).mock.calls[0][0];
    expect(prompt.choices).toEqual([
      {
        name: 'codex (gpt-tunnel-gateway_master)',
        message: expect.stringContaining('[30m ago] codex ('),
      },
      {
        name: 'codex2 (gpt-tunnel-gateway_master)',
        message: expect.stringContaining('[12h ago] codex2 ('),
      },
    ]);
    expect(prompt.symbols.prefix.submitted).toBe('>');
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

  it('reports when the selected session is already running', async () => {
    const profileSessionId = '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e';
    const currentCwd = process.cwd();
    (loadConfig as jest.Mock).mockReturnValue({
      profiles: {
        codex2: { executable: 'codex' },
        codex: { executable: 'codex' },
      },
    });
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'active-row',
        profile: 'codex2',
        sessionKey: 'airelay_master',
        invocationCwd: currentCwd,
        startedAt: Date.now(),
        argv: ['start', 'codex2', '--', 'resume', profileSessionId],
      },
    ]);
    (getSessions as jest.Mock).mockReturnValue([
      {
        id: 'runtime-active',
        profile: 'codex2',
        profileSessionId,
        pid: process.pid,
        controllerEndpoint: '/tmp/active-session.sock',
        lastUsed: Date.now(),
      },
    ]);
    (Enquirer.prompt as jest.Mock)
      .mockResolvedValueOnce({ historyEntry: 'codex2 (airelay_master)' })
      .mockResolvedValueOnce({ resumeAction: 'launch' });

    await resumeCommand();

    expect(runCommand).not.toHaveBeenCalled();
    expect(markLaunchHistoryUsed).not.toHaveBeenCalled();
    expect(Enquirer.prompt).toHaveBeenCalledTimes(2);
    expect((Enquirer.prompt as jest.Mock).mock.calls[1][0].choices).toEqual([
      { name: 'launch', message: 'Launch' },
      { name: 'switchProfile', message: 'Use another profile (same harness)' },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to resume session in this terminal, because this session is active in another terminal window.'
    );
    expect(console.error).toHaveBeenCalledWith(`Session ID: ${profileSessionId}`);
    expect(console.error).toHaveBeenCalledWith(
      'Use the existing terminal for this session, or choose "Start new session".'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('disambiguates duplicate profile/session-key labels without exposing history IDs', async () => {
    const currentCwd = process.cwd();
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'first-internal-row',
        profile: 'codex',
        sessionKey: 'same_key',
        invocationCwd: currentCwd,
        startedAt: 200,
        argv: ['start', 'codex', '--', 'resume', 'session-a'],
      },
      {
        id: 'second-internal-row',
        profile: 'codex',
        sessionKey: 'same_key',
        invocationCwd: currentCwd,
        startedAt: 100,
        argv: ['start', 'codex', '--', 'resume', 'session-b'],
      },
    ]);
    (Enquirer.prompt as jest.Mock).mockResolvedValueOnce({
      historyEntry: 'codex (same_key) #2',
    });

    await resumeCommand();

    const prompt = (Enquirer.prompt as jest.Mock).mock.calls[0][0];
    expect(prompt.choices.map((choice: { name: string }) => choice.name)).toEqual([
      'codex (same_key)',
      'codex (same_key) #2',
    ]);
    expect(runCommand).toHaveBeenCalledWith(
      'codex',
      ['resume', 'session-b'],
      expect.objectContaining({ sessionKey: 'same_key', usePty: true })
    );
  });

  it('offers only same-harness profiles and preserves the selected session launch', async () => {
    const now = 1_000_000_000;
    const currentCwd = process.cwd();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    (loadConfig as jest.Mock).mockReturnValue({
      profiles: {
        codex: { executable: 'codex' },
        codex2: { executable: 'codex' },
        opencode: { executable: 'opencode' },
      },
    });
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'codex-row',
        profile: 'codex',
        sessionKey: 'airelay_master',
        invocationCwd: currentCwd,
        startedAt: now - 30 * 60 * 1000,
        argv: [
          'start',
          'codex',
          '--key',
          'airelay_master',
          '--',
          'resume',
          '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
          '--dangerously-bypass-approvals-and-sandbox',
        ],
        command:
          'airelay start codex --key airelay_master -- resume 01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e --dangerously-bypass-approvals-and-sandbox',
      },
    ]);
    (Enquirer.prompt as jest.Mock)
      .mockResolvedValueOnce({ historyEntry: 'codex (airelay_master)' })
      .mockResolvedValueOnce({ resumeAction: 'switchProfile' })
      .mockResolvedValueOnce({ profile: 'codex2' });

    await resumeCommand();

    const actionPrompt = (Enquirer.prompt as jest.Mock).mock.calls[1][0];
    expect(actionPrompt.choices).toEqual([
      { name: 'launch', message: 'Launch' },
      { name: 'switchProfile', message: 'Use another profile (same harness)' },
    ]);
    const profilePrompt = (Enquirer.prompt as jest.Mock).mock.calls[2][0];
    expect(profilePrompt.choices).toEqual([{ name: 'codex2', message: 'codex2' }]);
    expect(runCommand).toHaveBeenCalledWith(
      'codex2',
      [
        'resume',
        '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
        '--dangerously-bypass-approvals-and-sandbox',
      ],
      expect.objectContaining({
        cwd: currentCwd,
        sessionKey: 'airelay_master',
        profileSessionId: '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
        profileArgs: [
          'resume',
          '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
          '--dangerously-bypass-approvals-and-sandbox',
        ],
        usePty: true,
      })
    );
    expect(markLaunchHistoryUsed).toHaveBeenCalledWith('codex-row', expect.any(Number), 'codex2');
    jest.restoreAllMocks();
  });

  it('switches the latest session with alternatives first and marks the current profile', async () => {
    const now = 1_000_000_000;
    const currentCwd = process.cwd();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    (loadConfig as jest.Mock).mockReturnValue({
      profiles: {
        codex: { executable: 'codex' },
        codex2: { executable: 'codex' },
        opencode: { executable: 'opencode' },
      },
    });
    (getLaunchHistory as jest.Mock).mockReturnValue([
      {
        id: 'latest-row',
        profile: 'codex',
        sessionKey: 'airelay_master',
        invocationCwd: currentCwd,
        startedAt: now - 30 * 60 * 1000,
        argv: [
          'start',
          'codex',
          '--key',
          'airelay_master',
          '--',
          'resume',
          '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
          '--dangerously-bypass-approvals-and-sandbox',
        ],
        command:
          'airelay start codex --key airelay_master -- resume 01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e --dangerously-bypass-approvals-and-sandbox',
      },
    ]);
    expect(hasSwitchableLastSession()).toBe(true);
    (Enquirer.prompt as jest.Mock).mockResolvedValueOnce({ profile: 'codex2' });

    await switchLastSessionProfile();

    const profilePrompt = (Enquirer.prompt as jest.Mock).mock.calls[0][0];
    expect(profilePrompt.choices).toEqual([
      { name: 'codex2', message: 'codex2' },
      { name: 'codex', message: 'codex (current)' },
    ]);
    expect(profilePrompt.initial).toBe(0);
    expect(console.log).toHaveBeenNthCalledWith(1, '');
    expect(console.log).toHaveBeenNthCalledWith(2, 'Last session:');
    expect(console.log).toHaveBeenNthCalledWith(
      3,
      '  airelay_master -- resume 01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e --dangerously-bypass-approvals-and-sandbox'
    );
    expect(console.log).toHaveBeenNthCalledWith(4, '');
    expect(runCommand).toHaveBeenCalledWith(
      'codex2',
      [
        'resume',
        '01a0638b-bafd-7c82-ae0e-a2cdfeb4f63e',
        '--dangerously-bypass-approvals-and-sandbox',
      ],
      expect.objectContaining({ cwd: currentCwd, sessionKey: 'airelay_master', usePty: true })
    );
    expect(markLaunchHistoryUsed).toHaveBeenCalledWith('latest-row', expect.any(Number), 'codex2');
    jest.restoreAllMocks();
  });
});
