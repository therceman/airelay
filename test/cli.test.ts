import { parseArgs } from '../src/cli';

describe('parseArgs', () => {
  it('parses simple command', () => {
    const result = parseArgs(['node', 'airelay', 'list']);
    expect(result.command).toBe('list');
    expect(result.profile).toBeUndefined();
    expect(result.extraArgs).toEqual([]);
  });

  it('parses profile run with no args as error', () => {
    const result = parseArgs(['node', 'airelay', 'myprofile']);
    expect(result.command).toBe('error');
    expect(result.profile).toBe('myprofile');
  });

  it('parses profile with flags as error', () => {
    const result = parseArgs(['node', 'airelay', 'myprofile', '--help']);
    expect(result.command).toBe('error');
    expect(result.profile).toBe('myprofile');
  });

  it('parses profile with multiple flags as error', () => {
    const result = parseArgs(['node', 'airelay', 'myprofile', '-m', 'fast', '--verbose']);
    expect(result.command).toBe('error');
    expect(result.profile).toBe('myprofile');
  });

  it('parses run command with profile', () => {
    const result = parseArgs(['node', 'airelay', 'run', 'myprofile']);
    expect(result.command).toBe('run');
    expect(result.profile).toBe('myprofile');
    expect(result.extraArgs).toEqual([]);
  });

  it('parses run command with profile and args', () => {
    const result = parseArgs(['node', 'airelay', 'run', 'myprofile', '--help']);
    expect(result.command).toBe('run');
    expect(result.profile).toBe('myprofile');
    expect(result.extraArgs).toEqual(['--help']);
  });

  it('parses create command with flags', () => {
    const result = parseArgs(['node', 'airelay', 'create', 'myprofile', '-e', 'opencode']);
    expect(result.command).toBe('create');
    expect(result.profile).toBe('myprofile');
    expect(result.flags).toEqual({ e: 'opencode', executable: 'opencode' });
  });

  it('parses create with long flags', () => {
    const result = parseArgs([
      'node',
      'airelay',
      'create',
      'myprofile',
      '--executable',
      'codex',
      '--api-key',
      'sk-123',
    ]);
    expect(result.command).toBe('create');
    expect(result.profile).toBe('myprofile');
    expect(result.flags).toEqual({ executable: 'codex', 'api-key': 'sk-123' });
  });

  it('parses init with force flag', () => {
    const result = parseArgs(['node', 'airelay', 'init', '--force']);
    expect(result.command).toBe('init');
    expect(result.flags).toEqual({ force: true });
  });

  it('parses which command with profile', () => {
    const result = parseArgs(['node', 'airelay', 'which', 'myprofile']);
    expect(result.command).toBe('which');
    expect(result.profile).toBe('myprofile');
  });

  it('parses doctor with optional profile', () => {
    const result1 = parseArgs(['node', 'airelay', 'doctor']);
    expect(result1.command).toBe('doctor');
    expect(result1.profile).toBeUndefined();

    const result2 = parseArgs(['node', 'airelay', 'doctor', 'myprofile']);
    expect(result2.command).toBe('doctor');
    expect(result2.profile).toBe('myprofile');
  });

  it('parses help command', () => {
    const result = parseArgs(['node', 'airelay', 'help']);
    expect(result.command).toBe('help');
  });

  it('parses guide command', () => {
    const result = parseArgs(['node', 'airelay', 'guide']);
    expect(result.command).toBe('guide');
  });

  it('parses config set command', () => {
    const result = parseArgs([
      'node',
      'airelay',
      'config',
      'set',
      'settings.promptMaxLength',
      '1024',
    ]);
    expect(result.command).toBe('config');
    expect(result.profile).toBe('set');
    expect(result.args).toEqual(['settings.promptMaxLength', '1024']);
  });

  it('parses a negative config value as a positional value', () => {
    const result = parseArgs([
      'node',
      'airelay',
      'config',
      'set',
      'settings.promptMaxLength',
      '-1',
    ]);
    expect(result.profile).toBe('set');
    expect(result.args).toEqual(['settings.promptMaxLength', '-1']);
    expect(result.flags).toEqual({});
  });

  it('defaults to select when no command', () => {
    const result = parseArgs(['node', 'airelay']);
    expect(result.command).toBe('select');
  });

  it('handles -- separator as error', () => {
    const result = parseArgs(['node', 'airelay', 'myprofile', '--', '--help', '--verbose']);
    expect(result.command).toBe('error');
    expect(result.profile).toBe('myprofile');
  });

  it('handles -- separator with run command', () => {
    const result = parseArgs(['node', 'airelay', 'run', 'myprofile', '--', '--help', '--verbose']);
    expect(result.command).toBe('run');
    expect(result.profile).toBe('myprofile');
    expect(result.extraArgs).toEqual(['--help', '--verbose']);
  });

  it('parses short flags without value', () => {
    const result = parseArgs(['node', 'airelay', 'init', '-f']);
    expect(result.flags).toEqual({ f: true, force: true });
  });

  it('parses mixed short and long flags', () => {
    const result = parseArgs(['node', 'airelay', 'create', 'test', '-e', 'opencode', '--force']);
    expect(result.command).toBe('create');
    expect(result.profile).toBe('test');
    expect(result.flags).toEqual({ e: 'opencode', executable: 'opencode', force: true });
  });

  it('treats values starting with dash as error', () => {
    const result = parseArgs(['node', 'airelay', 'myprofile', '--help']);
    expect(result.command).toBe('error');
  });

  it('parses prompt command with session and text', () => {
    const result = parseArgs(['node', 'airelay', 'prompt', 'mysession', 'write a test']);
    expect(result.command).toBe('prompt');
    expect(result.profile).toBe('mysession');
    expect(result.args).toEqual(['write a test']);
  });

  it('parses prompt command with --text flag', () => {
    const result = parseArgs(['node', 'airelay', 'prompt', 'mysession', '--text', 'hello']);
    expect(result.command).toBe('prompt');
    expect(result.profile).toBe('mysession');
    expect(result.flags).toHaveProperty('text', 'hello');
  });

  it('parses prompt command with --no-enter flag', () => {
    const result = parseArgs(['node', 'airelay', 'prompt', 'mysession', 'hello', '--no-enter']);
    expect(result.command).toBe('prompt');
    expect(result.profile).toBe('mysession');
    expect(result.flags).toHaveProperty('no-enter', true);
  });

  it('prompt command shows error when missing session', () => {
    const result = parseArgs(['node', 'airelay', 'prompt']);
    expect(result.command).toBe('prompt');
    expect(result.profile).toBeUndefined();
  });

  it('parses sessions command', () => {
    const result = parseArgs(['node', 'airelay', 'sessions']);
    expect(result.command).toBe('sessions');
    expect(result.profile).toBeUndefined();
  });

  it('parses resume without a key for folder history selection', () => {
    const result = parseArgs(['node', 'airelay', 'resume']);
    expect(result.command).toBe('resume');
    expect(result.profile).toBeUndefined();
  });

  it('parses sessions command with --json flag', () => {
    const result = parseArgs(['node', 'airelay', 'sessions', '--json']);
    expect(result.command).toBe('sessions');
    expect(result.flags).toHaveProperty('json', true);
  });

  it('parses sessions command with --active flag', () => {
    const result = parseArgs(['node', 'airelay', 'sessions', '--active']);
    expect(result.command).toBe('sessions');
    expect(result.flags).toHaveProperty('active', true);
  });
});
