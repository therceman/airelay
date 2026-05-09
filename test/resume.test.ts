import { resumeCommand } from '../src/commands/resume';
import { runCommand } from '../src/commands/run';

jest.mock('../src/commands/run', () => ({
  runCommand: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/commands/sessions', () => ({
  findSessionByKey: jest.fn(),
  getSessions: jest.fn(),
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
});
