import { initCommand } from '../src/commands/init';
import fs from 'fs';
import path from 'path';
import { useTestEnv } from './test-utils';
import { loadConfig } from '../src/config/load';

describe('initCommand', () => {
  const testEnv = useTestEnv();
  const testConfigPath = testEnv.configPath;

  it('creates config file', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      initCommand(true);
    } finally {
      console.log = originalLog;
    }

    expect(fs.existsSync(testConfigPath)).toBe(true);
    const content = fs.readFileSync(testConfigPath, 'utf-8');
    expect(content).toContain('version: 1');
    expect(content).toContain('profiles:');
  });

  it('creates the detected codex profile without overriding the native Codex home', () => {
    initCommand(true, (name) => (name === 'codex' ? '/usr/local/bin/codex' : null));

    const config = loadConfig(testConfigPath);
    expect(config.profiles.codex).toEqual({ executable: 'codex' });
    expect(fs.existsSync(path.join(testEnv.testDir, 'codex'))).toBe(false);
  });

  it('creates the detected Devin profile without adding a Devin home override', () => {
    initCommand(true, (name) => (name === 'devin' ? '/home/test/.local/bin/devin' : null));

    const config = loadConfig(testConfigPath);
    expect(config.profiles.devin).toEqual({ executable: 'devin' });
  });

  it('does not overwrite existing config without force', () => {
    fs.writeFileSync(testConfigPath, 'version: 1\nprofiles:\n  existing:\n    executable: test\n');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      initCommand(false);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain('Config already exists');
    expect(logs.join('\n')).toContain('--force');
  });

  it('overwrites existing config with force', () => {
    fs.writeFileSync(testConfigPath, 'version: 1\nprofiles:\n  existing:\n    executable: test\n');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      initCommand(true);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).not.toContain('Config already exists');
  });

  it('creates config directory if missing', () => {
    const newDir = path.join(testEnv.testDir, 'new-config-dir-' + Date.now());
    const newConfigPath = path.join(newDir, 'config.yaml');
    const savedConfig = process.env.AIRELAY_CONFIG;
    process.env.AIRELAY_CONFIG = newConfigPath;

    try {
      initCommand(true);
      expect(fs.existsSync(newDir)).toBe(true);
      expect(fs.existsSync(newConfigPath)).toBe(true);
    } finally {
      process.env.AIRELAY_CONFIG = savedConfig;
      if (fs.existsSync(newDir)) {
        fs.rmSync(newDir, { recursive: true });
      }
    }
  });
});
