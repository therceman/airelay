import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, getConfigDir } from '../src/config/load';

describe('loadConfig', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-test-' + Date.now());
  const testConfigPath = path.join(testDir, 'config.yaml');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true });
  });

  it('throws when config not found', () => {
    expect(() => loadConfig('/nonexistent/config.yaml')).toThrow('Config file not found');
  });

  it('throws on invalid yaml', () => {
    fs.writeFileSync(testConfigPath, 'invalid: yaml: content:');
    expect(() => loadConfig(testConfigPath)).toThrow('Invalid YAML');
  });

  it('throws on invalid schema', () => {
    fs.writeFileSync(testConfigPath, 'version: 1\nprofiles: {}');
    expect(() => loadConfig(testConfigPath)).toThrow('Config validation failed');
  });

  it('loads valid config', () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test-profile:
    executable: opencode
    description: Test profile`
    );
    const config = loadConfig(testConfigPath);
    expect(config.profiles['test-profile']).toBeDefined();
    expect(config.profiles['test-profile']?.executable).toBe('opencode');
    expect(config.settings?.promptMaxLength).toBe(-1);
    expect(config.settings?.hibernateAfter).toBe('5m');
    expect(config.settings?.harnessSelfUpdate).toBe(false);
  });

  it('supports AIRELAY_CONFIG env override', () => {
    const customPath = path.join(testDir, 'custom.yaml');
    fs.writeFileSync(
      customPath,
      `version: 1
profiles:
  custom:
    executable: codex`
    );
    process.env.AIRELAY_CONFIG = customPath;
    const config = loadConfig();
    expect(config.profiles['custom']).toBeDefined();
    delete process.env.AIRELAY_CONFIG;
  });
});

describe('getConfigDir', () => {
  it('returns dirname of config path', () => {
    const dir = getConfigDir('/some/path/config.yaml');
    expect(dir).toBe('/some/path');
  });
});
