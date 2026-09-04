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
    expect(calls[1][0]).toContain('promptMaxLength: unlimited');
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
      expect.stringContaining('Set settings.promptMaxLength = 1024')
    );
  });

  it('supports unlimited prompt length', () => {
    configSetCommand('settings.promptMaxLength', 'unlimited');

    const saved = YAML.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { promptMaxLength: string };
    };
    expect(saved.settings.promptMaxLength).toBe('unlimited');
  });

  it('rejects invalid setting values and keys', () => {
    expect(() => configSetCommand('settings.promptMaxLength', '0')).toThrow('positive integer');
    expect(() => configSetCommand('settings.promptMaxLength', 'not-unlimited')).toThrow(
      'positive integer or "unlimited"'
    );
    expect(() => configSetCommand('prompt.maxLength', '1')).toThrow('Unknown config key');
    expect(() => configSetCommand('unknown.key', '1')).toThrow('Unknown config key');
  });

  it('shows config command help', () => {
    configHelpCommand();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('airelay config list'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('settings.promptMaxLength'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unicode code points'));
  });
});
