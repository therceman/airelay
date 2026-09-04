import fs from 'fs';
import YAML from 'yaml';
import { configHelpCommand, configListCommand, configSetCommand } from '../src/commands/config';
import { createTestConfig, useTestEnv } from './test-utils';

const testEnv = useTestEnv();

describe('config command', () => {
  const originalLog = console.log;

  beforeEach(() => {
    createTestConfig(testEnv.configPath, {
      worker: {
        executable: 'node',
        env: { TEST_API_KEY: 'secret-value', TEST_HOME: '/tmp/worker' },
      },
    });
    console.log = jest.fn();
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('lists config with defaults and redacts secrets', () => {
    configListCommand();

    const calls = (console.log as jest.Mock).mock.calls;
    expect(calls[0][0]).toContain(testEnv.configPath);
    expect(calls[1][0]).toContain('promptMaxLength: -1');
    expect(calls[1][0]).toContain('TEST_API_KEY: <redacted>');
    expect(calls[1][0]).toContain('TEST_HOME: /tmp/worker');
    expect(calls[1][0]).not.toContain('secret-value');
  });

  it('sets prompt max length and preserves existing config', () => {
    configSetCommand('settings.promptMaxLength', '1024');

    const saved = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { promptMaxLength: number };
      profiles: Record<string, unknown>;
    };
    expect(saved.settings.promptMaxLength).toBe(1024);
    expect(saved.profiles.worker).toBeDefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Set settings.promptMaxLength in')
    );
  });

  it('sets and validates hibernate duration', () => {
    configSetCommand('settings.hibernateAfter', '15m');

    const saved = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { hibernateAfter: string };
    };
    expect(saved.settings.hibernateAfter).toBe('15m');

    configSetCommand('settings.hibernateAfter', 'off');
    const disabled = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { hibernateAfter: string };
    };
    expect(disabled.settings.hibernateAfter).toBe('off');
  });

  it('supports unlimited prompt length with -1', () => {
    configSetCommand('settings.promptMaxLength', '-1');

    const saved = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { promptMaxLength: number };
    };
    expect(saved.settings.promptMaxLength).toBe(-1);
  });

  it('updates profile fields without editing YAML', () => {
    configSetCommand('profiles.worker.cwd', '~/git/work');
    configSetCommand('profiles.worker.description', 'Worker profile');
    configSetCommand('profiles.worker.args', '["--sandbox", "workspace-write"]');
    configSetCommand('profiles.worker.env.CODEX_HOME', '~/.codex-worker');
    configSetCommand('profiles.worker.createDirs', '["~/.codex-worker"]');

    const saved = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      profiles: {
        worker: {
          cwd: string;
          description: string;
          args: string[];
          env: Record<string, string>;
          createDirs: string[];
        };
      };
    };
    expect(saved.profiles.worker).toMatchObject({
      cwd: '~/git/work',
      description: 'Worker profile',
      args: ['--sandbox', 'workspace-write'],
      env: {
        CODEX_HOME: '~/.codex-worker',
      },
      createDirs: ['~/.codex-worker'],
    });
    expect(fs.readdirSync(testEnv.testDir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects invalid setting values and keys', () => {
    expect(() => configSetCommand('settings.promptMaxLength', '0')).toThrow('positive integer');
    expect(() => configSetCommand('settings.promptMaxLength', 'not-a-number')).toThrow(
      'positive integer or -1 (unlimited)'
    );
    expect(() => configSetCommand('settings.promptMaxLength', 'unlimited')).toThrow(
      'positive integer or -1 (unlimited)'
    );
    expect(() => configSetCommand('settings.hibernateAfter', '0m')).toThrow('duration');
    expect(() => configSetCommand('settings.hibernateAfter', '5weeks')).toThrow('duration');
    expect(() => configSetCommand('settings.hibernateAfter', '31d')).toThrow('duration');
    expect(() => configSetCommand('prompt.maxLength', '1')).toThrow('Unknown config key');
    expect(() => configSetCommand('profiles.worker.args', 'not-an-array')).toThrow();
    expect(() => configSetCommand('profiles.unknown.cwd', '~/missing')).toThrow(
      'Profile not found'
    );
    expect(() => configSetCommand('unknown.key', '1')).toThrow('Unknown config key');
  });

  it('shows config command help', () => {
    configHelpCommand();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('airelay config list'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('settings.promptMaxLength'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('settings.hibernateAfter'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unicode code points'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('profiles.<profile>.args'));
  });
});
