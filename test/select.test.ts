import {
  buildMainChoices,
  getLastUsedProfile,
  selectCommand,
  setLastUsedProfile,
} from '../src/commands/select';
import Enquirer from 'enquirer';
import { runCommand } from '../src/commands/run';
import { chooseSessionWorkspace } from '../src/commands/workspace-select';
import { createTestConfig, useTestEnv } from './test-utils';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

jest.mock('enquirer', () => ({ prompt: jest.fn() }));
jest.mock('../src/commands/run', () => ({ runCommand: jest.fn() }));
jest.mock('../src/commands/workspace-select', () => ({ chooseSessionWorkspace: jest.fn() }));

describe('last-used tracking', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-lastused-test-' + process.pid + '-' + Date.now());
  const testLastUsedPath = path.join(testDir, 'last-used');
  const originalEnv = process.env.AIRELAY_LAST_USED;
  const originalCwd = process.cwd();

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.AIRELAY_LAST_USED = testLastUsedPath;
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true });
    if (originalEnv) {
      process.env.AIRELAY_LAST_USED = originalEnv;
    } else {
      delete process.env.AIRELAY_LAST_USED;
    }
  });

  beforeEach(() => {
    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const testLastUsedFile = path.join(testLastUsedPath, `${cwdHash}.json`);
    if (fs.existsSync(testLastUsedFile)) {
      fs.unlinkSync(testLastUsedFile);
    }
  });

  it('returns null when no last-used file exists', () => {
    expect(getLastUsedProfile()).toBeNull();
  });

  it('saves and retrieves last-used profile', () => {
    setLastUsedProfile('my-profile');
    const profile = getLastUsedProfile();
    expect(profile).toBe('my-profile');
  });

  it('returns null for corrupted file', () => {
    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const testLastUsedFile = path.join(testLastUsedPath, `${cwdHash}.json`);
    fs.writeFileSync(testLastUsedFile, 'invalid json', 'utf-8');
    expect(getLastUsedProfile()).toBeNull();
  });

  it('creates directory if missing', () => {
    const nestedDir = path.join(testDir, 'nested-dir-' + Date.now());
    const nestedPath = path.join(nestedDir, 'last-used');
    const savedEnv = process.env.AIRELAY_LAST_USED;
    process.env.AIRELAY_LAST_USED = nestedPath;

    setLastUsedProfile('test-profile');

    const cwdHash = crypto.createHash('sha256').update(originalCwd).digest('hex').substring(0, 16);
    const nestedFile = path.join(nestedPath, `${cwdHash}.json`);
    expect(fs.existsSync(nestedFile)).toBe(true);

    process.env.AIRELAY_LAST_USED = savedEnv;
    fs.rmSync(nestedDir, { recursive: true });
  });
});

describe('main selector choices', () => {
  it('shows project resume, current project resume, and start choices', () => {
    expect(buildMainChoices(true, true)).toEqual([
      { name: 'ResumeCurrent', message: 'Resume current project session' },
      { name: 'Resume', message: 'Resume project session' },
      { name: 'Start', message: 'Start new session' },
    ]);
  });

  it('only shows current project resume when it has resumable history', () => {
    expect(buildMainChoices(true, false)).toEqual([
      { name: 'Resume', message: 'Resume project session' },
      { name: 'Start', message: 'Start new session' },
    ]);
  });

  it('keeps start available when there are no resumable sessions', () => {
    expect(buildMainChoices(false)).toEqual([{ name: 'Start', message: 'Start new session' }]);
  });

  it('adds last-session profile switching when an alternative is available', () => {
    expect(buildMainChoices(true, true, true)).toEqual([
      { name: 'ResumeCurrent', message: 'Resume current project session' },
      { name: 'SwitchLast', message: 'Switch last session profile (same harness)' },
      { name: 'Resume', message: 'Resume project session' },
      { name: 'Start', message: 'Start new session' },
    ]);
  });
});

describe('start confirmation', () => {
  const env = useTestEnv();
  const prompt = jest.mocked(Enquirer.prompt);
  const run = jest.mocked(runCommand);
  const chooseWorkspace = jest.mocked(chooseSessionWorkspace);
  let log: jest.SpyInstance;
  let exit: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    createTestConfig(env.configPath, { devin: { executable: 'devin' } });
    run.mockResolvedValue(0);
  });

  afterEach(() => {
    log.mockRestore();
    exit.mockRestore();
  });

  it.each([false, true])('keeps the launch question short (Workspace: %s)', async (managed) => {
    const root = path.join(env.testDir, 'workspaces');
    const workspace = managed
      ? { selector: 'agentvm.lead-win', root, path: path.join(root, 'agentvm/agents/lead-win') }
      : undefined;
    chooseWorkspace.mockResolvedValue(workspace);
    prompt
      .mockResolvedValueOnce({ action: 'Start' })
      .mockResolvedValueOnce({ profile: 'devin' })
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ sessionId: '' });

    await selectCommand();

    expect(prompt.mock.calls[2][0]).toMatchObject({
      name: 'confirm',
      message: managed ? 'Start devin in agentvm.lead-win?' : 'Start devin?',
      initial: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('devin', [], expect.objectContaining({ workspace }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('still cancels without starting a session', async () => {
    chooseWorkspace.mockResolvedValue(undefined);
    prompt
      .mockResolvedValueOnce({ action: 'Start' })
      .mockResolvedValueOnce({ profile: 'devin' })
      .mockResolvedValueOnce({ confirm: false });

    await selectCommand();

    expect(run).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Cancelled');
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it.each([
    'Workspace binding does not match its manifest.',
    'Workspace operation in progress; inspect the workspace lock before retrying.',
  ])('passes the real launch error to the CLI: %s', async (message) => {
    const root = path.join(env.testDir, 'workspaces');
    chooseWorkspace.mockResolvedValue({
      selector: 'agentvm.lead-win',
      root,
      path: path.join(root, 'agentvm/agents/lead-win'),
    });
    prompt
      .mockResolvedValueOnce({ action: 'Start' })
      .mockResolvedValueOnce({ profile: 'devin' })
      .mockResolvedValueOnce({ confirm: true });
    const error = new Error(message);
    run.mockRejectedValue(error);

    await expect(selectCommand()).rejects.toBe(error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(exit).not.toHaveBeenCalled();
  });
});
