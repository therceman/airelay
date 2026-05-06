import { runCommand, detectResumeSessionId } from '../src/commands/run';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('runCommand', () => {
  const testDir = path.join(os.tmpdir(), 'airelay-run-test-' + Date.now());
  const testConfigPath = path.join(testDir, 'config.yaml');
  const testSessionsPath = path.join(testDir, 'sessions.json');
  const testSocketsDir = path.join(testDir, 'sockets');

  const originalLog = console.log;
  const originalConfig = process.env.AIRELAY_CONFIG;
  const originalSessions = process.env.AIRELAY_SESSIONS;
  const originalSocketsDir = process.env.AIRELAY_SOCKETS_DIR;

  beforeAll(() => {
    fs.mkdirSync(testSocketsDir, { recursive: true });
    console.log = () => {};
    process.env.AIRELAY_SESSIONS = testSessionsPath;
    process.env.AIRELAY_SOCKETS_DIR = testSocketsDir;
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log = originalLog;
    if (originalConfig) {
      process.env.AIRELAY_CONFIG = originalConfig;
    } else {
      delete process.env.AIRELAY_CONFIG;
    }
    if (originalSessions) {
      process.env.AIRELAY_SESSIONS = originalSessions;
    } else {
      delete process.env.AIRELAY_SESSIONS;
    }
    if (originalSocketsDir) {
      process.env.AIRELAY_SOCKETS_DIR = originalSocketsDir;
    } else {
      delete process.env.AIRELAY_SOCKETS_DIR;
    }
  });

  beforeEach(() => {
    delete process.env.AIRELAY_CONFIG;
    if (fs.existsSync(testSessionsPath)) {
      fs.unlinkSync(testSessionsPath);
    }
    // Clean up any leftover socket files
    if (fs.existsSync(testSocketsDir)) {
      const files = fs.readdirSync(testSocketsDir);
      for (const f of files) {
        fs.unlinkSync(path.join(testSocketsDir, f));
      }
    }
  });

  afterEach(() => {
    delete process.env.AIRELAY_CONFIG;
  });

  it('throws error with helpful message when profile not found', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  existing-profile:
    executable: opencode`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    await expect(runCommand('nonexistent', [])).rejects.toThrow('Profile not found: nonexistent');
    await expect(runCommand('nonexistent', [])).rejects.toThrow('Available profiles:');
    await expect(runCommand('nonexistent', [])).rejects.toThrow('existing-profile');
  });

  it('throws error when executable not found', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: nonexistent-executable`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    await expect(runCommand('test', [])).rejects.toThrow(
      'Executable not found in PATH: nonexistent-executable'
    );
  });

  it('passes extra args to child process', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('test', []);
    expect(exitCode).toBe(0);
  });

  it('merges profile args with extra args', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('test', []);
    expect(exitCode).toBe(0);
  });

  it('starts a controller and pre-saves a session', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('test', []);
    expect(exitCode).toBe(0);

    // Verify temp session was cleaned up after exit
    const sessionsData = JSON.parse(fs.readFileSync(testSessionsPath, 'utf-8'));
    const testSessions = sessionsData.test || [];
    // Temp sessions use sessionKey as ID (no pending_ prefix), and have controllerEndpoint
    const controllerSessions = testSessions.filter(
      (s: { controllerEndpoint?: string }) => s.controllerEndpoint
    );
    expect(controllerSessions.length).toBe(0);
  });

  it('controller socket file is cleaned up after exit', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    await runCommand('test', []);

    // Socket dir should be empty (all sockets cleaned up)
    const files = fs.readdirSync(testSocketsDir);
    const sockFiles = files.filter((f) => f.endsWith('.sock'));
    expect(sockFiles.length).toBe(0);
  });

  it('creates directories from createDirs', async () => {
    const tempDir = path.join(testDir, 'created-dir-' + Date.now());
    const dirPath = path.join(tempDir, 'subdir');

    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)
    createDirs:
      - ${dirPath}`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    expect(fs.existsSync(dirPath)).toBe(false);
    await runCommand('test', []);
    expect(fs.existsSync(dirPath)).toBe(true);

    fs.rmSync(tempDir, { recursive: true });
  });

  it('uses provided sessionKey option instead of generating random one', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    let capturedKey = '';
    await runCommand('test', [], {
      sessionKey: 'my_reserved_key',
      onSessionStart: (info) => {
        capturedKey = info.sessionKey;
      },
    });

    expect(capturedKey).toBe('my_reserved_key');
  });

  it('onSessionStart callback fires with session key and endpoint', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    let capturedInfo: { sessionKey: string; controllerEndpoint: string } | null = null;

    const exitCode = await runCommand('test', [], {
      onSessionStart: (info) => {
        capturedInfo = info;
      },
    });

    expect(exitCode).toBe(0);
    expect(capturedInfo).not.toBeNull();
    expect(capturedInfo!.sessionKey).toMatch(/^test_/);
    expect(capturedInfo!.controllerEndpoint).toContain('test_');
    expect(capturedInfo!.controllerEndpoint).toMatch(/\.sock$/);
  });

  it('injects AIRELAY_SESSION_KEY into child process environment', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - "var k=process.env.AIRELAY_SESSION_KEY||'';var p=process.env.AIRELAY_PROFILE||'';var i=process.env.AIRELAY_SESSION_ID||'';var c=process.env.AIRELAY_CWD||'';process.exit(k&&p&&i&&c?0:1)"`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('test', []);
    expect(exitCode).toBe(0);
  });

  it('injects AIRELAY_PROFILE with profile name', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  envcheck:
    executable: node
    args:
      - -e
      - "process.exit(process.env.AIRELAY_PROFILE === 'envcheck' ? 0 : 1)"`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('envcheck', []);
    expect(exitCode).toBe(0);
  });

  it('injects AIRELAY_CWD as absolute path', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - "process.exit(process.env.AIRELAY_CWD&&process.env.AIRELAY_CWD.startsWith('/')?0:1)"`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    const exitCode = await runCommand('test', []);
    expect(exitCode).toBe(0);
  });

  it('session key env var matches onSessionStart key', async () => {
    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - "process.exit(process.env.AIRELAY_SESSION_KEY?0:1)"`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    let startKey = '';
    await runCommand('test', [], {
      onSessionStart: (info) => {
        startKey = info.sessionKey;
      },
    });

    // The start key should be non-empty (generated)
    expect(startKey).toMatch(/^test_/);
  });

  it('creates directories from env paths', async () => {
    const tempDir = path.join(testDir, 'env-dir-' + Date.now());
    const envPath = path.join(tempDir, 'config');

    fs.writeFileSync(
      testConfigPath,
      `version: 1
profiles:
  test:
    executable: node
    args:
      - -e
      - process.exit(0)
    env:
      XDG_CONFIG_HOME: ${envPath}`
    );
    process.env.AIRELAY_CONFIG = testConfigPath;

    expect(fs.existsSync(envPath)).toBe(false);
    await runCommand('test', []);
    expect(fs.existsSync(envPath)).toBe(true);

    fs.rmSync(tempDir, { recursive: true });
  });

  describe('detectResumeSessionId', () => {
    it('returns session id for resume <id> args', () => {
      expect(detectResumeSessionId(['resume', 'abc123'])).toBe('abc123');
    });

    it('returns session id for -s <id> args', () => {
      expect(detectResumeSessionId(['-s', 'ses_xxx'])).toBe('ses_xxx');
    });

    it('returns undefined for empty args', () => {
      expect(detectResumeSessionId([])).toBeUndefined();
    });

    it('returns undefined for args without resume flag', () => {
      expect(detectResumeSessionId(['other', 'arg'])).toBeUndefined();
    });

    it('returns undefined when resume flag has no following arg', () => {
      expect(detectResumeSessionId(['resume'])).toBeUndefined();
    });
  });
});
