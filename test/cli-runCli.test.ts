import { runCli, parseArgs } from '../src/cli';
/* eslint-disable @typescript-eslint/no-var-requires */

// Mock all command modules
jest.mock('../src/commands/run', () => ({
  runCommand: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/commands/list', () => ({
  listCommand: jest.fn(),
  listCommandJson: jest.fn().mockReturnValue([]),
}));

jest.mock('../src/commands/which', () => ({
  whichCommand: jest.fn(),
}));

jest.mock('../src/commands/doctor', () => ({
  doctorCommand: jest.fn(),
}));

jest.mock('../src/commands/init', () => ({
  initCommand: jest.fn(),
}));

jest.mock('../src/commands/create', () => ({
  createCommand: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/commands/select', () => ({
  selectCommand: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/commands/prompt', () => ({
  promptCommand: jest.fn().mockResolvedValue(0),
}));

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.exit = jest.fn() as any;
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;
  jest.clearAllMocks();
});

describe('runCli', () => {
  it('executes help command and outputs help text', async () => {
    process.argv = ['node', 'cli.js', 'help'];
    await runCli();

    expect(console.log).toHaveBeenCalled();
    const output = (console.log as jest.Mock).mock.calls[0][0];
    expect(output).toContain('airelay - Cross-platform CLI');
    expect(output).toContain('Usage:');
    expect(output).toContain('Commands:');
    expect(output).toContain('help');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('executes list command', async () => {
    process.argv = ['node', 'cli.js', 'list'];
    await runCli();

    const { listCommand } = require('../src/commands/list');
    expect(listCommand).toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('executes list command with --json flag', async () => {
    process.argv = ['node', 'cli.js', 'list', '--json'];
    await runCli();

    const { listCommandJson } = require('../src/commands/list');
    expect(listCommandJson).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
    const output = (console.log as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(output)).toEqual([]);
  });

  it('executes init command', async () => {
    process.argv = ['node', 'cli.js', 'init'];
    await runCli();

    const { initCommand } = require('../src/commands/init');
    expect(initCommand).toHaveBeenCalledWith(false);
  });

  it('executes init command with --force flag', async () => {
    process.argv = ['node', 'cli.js', 'init', '--force'];
    await runCli();

    const { initCommand } = require('../src/commands/init');
    expect(initCommand).toHaveBeenCalledWith(true);
  });

  it('executes which command with profile', async () => {
    process.argv = ['node', 'cli.js', 'which', 'myprofile'];
    await runCli();

    const { whichCommand } = require('../src/commands/which');
    expect(whichCommand).toHaveBeenCalledWith('myprofile');
  });

  it('shows error when which command missing profile', async () => {
    process.argv = ['node', 'cli.js', 'which'];
    await runCli();

    expect(console.error).toHaveBeenCalledWith('Error: Profile name required');
    expect(console.error).toHaveBeenCalledWith('Usage: airelay which <profile>');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('executes doctor command without profile', async () => {
    process.argv = ['node', 'cli.js', 'doctor'];
    await runCli();

    const { doctorCommand } = require('../src/commands/doctor');
    expect(doctorCommand).toHaveBeenCalledWith(undefined);
  });

  it('executes doctor command with profile', async () => {
    process.argv = ['node', 'cli.js', 'doctor', 'myprofile'];
    await runCli();

    const { doctorCommand } = require('../src/commands/doctor');
    expect(doctorCommand).toHaveBeenCalledWith('myprofile');
  });

  it('executes create command with profile', async () => {
    process.argv = ['node', 'cli.js', 'create', 'myprofile'];
    await runCli();

    const { createCommand } = require('../src/commands/create');
    expect(createCommand).toHaveBeenCalledWith(
      'myprofile',
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it('executes create command with all flags', async () => {
    process.argv = [
      'node',
      'cli.js',
      'create',
      'myprofile',
      '-e',
      'opencode',
      '-k',
      'sk-123',
      '-d',
      '/tmp',
      '-f',
    ];
    await runCli();

    const { createCommand } = require('../src/commands/create');
    expect(createCommand).toHaveBeenCalledWith('myprofile', 'opencode', 'sk-123', '/tmp', true);
  });

  it('executes create command without profile (interactive)', async () => {
    process.argv = ['node', 'cli.js', 'create'];
    await runCli();

    const { createCommand } = require('../src/commands/create');
    expect(createCommand).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it('executes run command with profile', async () => {
    process.argv = ['node', 'cli.js', 'run', 'myprofile'];
    await runCli();

    const { runCommand } = require('../src/commands/run');
    expect(runCommand).toHaveBeenCalledWith('myprofile', []);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('executes run command with extra args', async () => {
    process.argv = ['node', 'cli.js', 'run', 'myprofile', '--', '--verbose'];
    await runCli();

    const { runCommand } = require('../src/commands/run');
    expect(runCommand).toHaveBeenCalledWith('myprofile', ['--verbose']);
  });

  it('shows error when run command missing profile', async () => {
    process.argv = ['node', 'cli.js', 'run'];
    await runCli();

    expect(console.error).toHaveBeenCalledWith('Error: Profile name required');
    expect(console.error).toHaveBeenCalledWith('Usage: airelay run <profile>');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('executes prompt command with --only-sequence', async () => {
    process.argv = ['node', 'cli.js', 'prompt', 'sess_1', '--only-sequence', '\\x1b[106;4u'];
    await runCli();

    const { promptCommand } = require('../src/commands/prompt');
    expect(promptCommand).toHaveBeenCalledWith('sess_1', undefined, {
      enter: true,
      onlyEnter: false,
      onlySequence: '\\x1b[106;4u',
    });
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('executes prompt command with --only-enter', async () => {
    process.argv = ['node', 'cli.js', 'prompt', 'sess_1', '--only-enter'];
    await runCli();

    const { promptCommand } = require('../src/commands/prompt');
    expect(promptCommand).toHaveBeenCalledWith('sess_1', undefined, {
      enter: true,
      onlyEnter: true,
      onlySequence: undefined,
    });
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('executes select command when no args', async () => {
    process.argv = ['node', 'cli.js'];
    await runCli();

    const { selectCommand } = require('../src/commands/select');
    expect(selectCommand).toHaveBeenCalled();
  });

  it('executes select command explicitly', async () => {
    process.argv = ['node', 'cli.js', 'select'];
    await runCli();

    const { selectCommand } = require('../src/commands/select');
    expect(selectCommand).toHaveBeenCalled();
  });

  it('shows error for unknown command', async () => {
    process.argv = ['node', 'cli.js', 'unknown'];
    await runCli();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown command or profile')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('catches and logs errors', async () => {
    const { selectCommand } = require('../src/commands/select');
    selectCommand.mockRejectedValueOnce(new Error('Test error'));

    process.argv = ['node', 'cli.js'];
    await runCli();

    expect(console.error).toHaveBeenCalledWith('Error: Test error');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('parseArgs', () => {
  it('parses help command', () => {
    const result = parseArgs(['node', 'airelay', 'help']);
    expect(result.command).toBe('help');
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it('parses help command - extra args become profile (limitation)', () => {
    const result = parseArgs(['node', 'airelay', 'help', 'extra']);
    expect(result.command).toBe('help');
    // Note: parser treats first positional as profile for all commands
    expect(result.profile).toBe('extra');
  });

  it('handles unknown command as error', () => {
    const result = parseArgs(['node', 'airelay', 'unknown']);
    expect(result.command).toBe('error');
    expect(result.profile).toBe('unknown');
  });

  it('handles empty args as select', () => {
    const result = parseArgs(['node', 'airelay']);
    expect(result.command).toBe('select');
  });

  it('parses all known commands', () => {
    const commands = [
      'init',
      'create',
      'list',
      'which',
      'doctor',
      'run',
      'help',
      'select',
      'prompt',
      'sessions',
    ];
    commands.forEach((cmd) => {
      const result = parseArgs(['node', 'airelay', cmd]);
      expect(result.command).toBe(cmd);
    });
  });
});

it('help text includes prompt command', async () => {
  process.argv = ['node', 'cli.js', 'help'];
  await runCli();

  expect(console.log).toHaveBeenCalled();
  const output = (console.log as jest.Mock).mock.calls[0][0];
  expect(output).toContain('prompt');
  expect(output).toContain('Send input to an active session');
  expect(output).toContain('sessions');
  expect(output).toContain('List saved sessions');
});
