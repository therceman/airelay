import { doctorCommand } from '../src/commands/doctor';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('doctor', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-doctor-test-' + Date.now());
  const testConfigPath = path.join(testDir, 'config.yaml');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true });
  });

  it('returns error when config missing', () => {
    const nonExistentPath = path.join(
      os.tmpdir(),
      'nonexistent-airelay-config-' + Date.now(),
      'config.yaml'
    );
    process.env.AIRELAY_CONFIG = nonExistentPath;
    const result = doctorCommand();
    delete process.env.AIRELAY_CONFIG;
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Config file not found');
  });

  it('returns ok for valid config', () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: nonexistent`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;
    const result = doctorCommand();
    delete process.env.AIRELAY_CONFIG;
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('not found in PATH');
  });

  it('checks specific profile', () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: nonexistent`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;
    const result = doctorCommand('test');
    delete process.env.AIRELAY_CONFIG;
    expect(result.ok).toBe(false);
  });

  it('warns about the legacy init-generated codex home without failing diagnostics', () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  codex:
    executable: codex
    env:
      CODEX_HOME: ${path.join(os.homedir(), '.airelay', 'codex')}`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const result = doctorCommand('codex');

    delete process.env.AIRELAY_CONFIG;

    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toContain('legacy init-generated CODEX_HOME');
    expect(result.warnings.join('\n')).toContain('config unset profiles.codex.env.CODEX_HOME');
  });
});
