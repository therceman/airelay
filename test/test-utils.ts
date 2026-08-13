import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TestEnv {
  testDir: string;
  configPath: string;
  sessionsPath: string;
  historyPath: string;
  lastUsedPath: string;
  pidsPath: string;
  socketsDir: string;
  transcriptsDir: string;
  originalEnv: {
    AIRELAY_CONFIG?: string;
    AIRELAY_SESSIONS?: string;
    AIRELAY_HISTORY?: string;
    AIRELAY_LAST_USED?: string;
    AIRELAY_PIDS?: string;
    AIRELAY_SOCKETS_DIR?: string;
    AIRELAY_TRANSCRIPTS_DIR?: string;
  };
}

/**
 * Creates an isolated test environment with temp config files.
 * Automatically sets AIRELAY_* environment variables to prevent tests
 * from touching the real ~/.airelay directory.
 *
 * Usage:
 * ```ts
 * const testEnv = setupTestEnv();
 *
 * beforeAll(() => {
 *   testEnv.setup();
 * });
 *
 * afterAll(() => {
 *   testEnv.cleanup();
 * });
 * ```
 */
export function setupTestEnv(): TestEnv {
  const testDir = path.join(os.tmpdir(), `airelay-test-${process.pid}-${Date.now()}`);
  const configPath = path.join(testDir, 'config.yaml');
  const sessionsPath = path.join(testDir, 'sessions.json');
  const historyPath = path.join(testDir, 'launch-history.json');
  const lastUsedPath = path.join(testDir, 'last-used');
  const pidsPath = path.join(testDir, 'pids.json');
  const socketsDir = path.join(testDir, 'sockets');
  const transcriptsDir = path.join(testDir, 'transcripts');

  const originalEnv = {
    AIRELAY_CONFIG: process.env.AIRELAY_CONFIG,
    AIRELAY_SESSIONS: process.env.AIRELAY_SESSIONS,
    AIRELAY_HISTORY: process.env.AIRELAY_HISTORY,
    AIRELAY_LAST_USED: process.env.AIRELAY_LAST_USED,
    AIRELAY_PIDS: process.env.AIRELAY_PIDS,
    AIRELAY_SOCKETS_DIR: process.env.AIRELAY_SOCKETS_DIR,
    AIRELAY_TRANSCRIPTS_DIR: process.env.AIRELAY_TRANSCRIPTS_DIR,
  };

  return {
    testDir,
    configPath,
    sessionsPath,
    historyPath,
    lastUsedPath,
    pidsPath,
    socketsDir,
    transcriptsDir,
    originalEnv,
  };
}

/**
 * Sets up the test environment:
 * - Creates temp directory
 * - Sets all AIRELAY_* environment variables
 */
export function setupEnv(env: TestEnv): void {
  fs.mkdirSync(env.testDir, { recursive: true });

  process.env.AIRELAY_CONFIG = env.configPath;
  process.env.AIRELAY_SESSIONS = env.sessionsPath;
  process.env.AIRELAY_HISTORY = env.historyPath;
  process.env.AIRELAY_LAST_USED = env.lastUsedPath;
  process.env.AIRELAY_PIDS = env.pidsPath;
  process.env.AIRELAY_SOCKETS_DIR = env.socketsDir;
  process.env.AIRELAY_TRANSCRIPTS_DIR = env.transcriptsDir;
}

/**
 * Cleans up the test environment:
 * - Removes temp directory
 * - Restores original AIRELAY_* environment variables
 */
export function cleanupEnv(env: TestEnv): void {
  try {
    if (fs.existsSync(env.testDir)) {
      fs.rmSync(env.testDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }

  // Restore original environment
  if (env.originalEnv.AIRELAY_CONFIG) {
    process.env.AIRELAY_CONFIG = env.originalEnv.AIRELAY_CONFIG;
  } else {
    delete process.env.AIRELAY_CONFIG;
  }

  if (env.originalEnv.AIRELAY_SESSIONS) {
    process.env.AIRELAY_SESSIONS = env.originalEnv.AIRELAY_SESSIONS;
  } else {
    delete process.env.AIRELAY_SESSIONS;
  }

  if (env.originalEnv.AIRELAY_HISTORY) {
    process.env.AIRELAY_HISTORY = env.originalEnv.AIRELAY_HISTORY;
  } else {
    delete process.env.AIRELAY_HISTORY;
  }

  if (env.originalEnv.AIRELAY_LAST_USED) {
    process.env.AIRELAY_LAST_USED = env.originalEnv.AIRELAY_LAST_USED;
  } else {
    delete process.env.AIRELAY_LAST_USED;
  }

  if (env.originalEnv.AIRELAY_PIDS) {
    process.env.AIRELAY_PIDS = env.originalEnv.AIRELAY_PIDS;
  } else {
    delete process.env.AIRELAY_PIDS;
  }

  if (env.originalEnv.AIRELAY_SOCKETS_DIR) {
    process.env.AIRELAY_SOCKETS_DIR = env.originalEnv.AIRELAY_SOCKETS_DIR;
  } else {
    delete process.env.AIRELAY_SOCKETS_DIR;
  }

  if (env.originalEnv.AIRELAY_TRANSCRIPTS_DIR) {
    process.env.AIRELAY_TRANSCRIPTS_DIR = env.originalEnv.AIRELAY_TRANSCRIPTS_DIR;
  } else {
    delete process.env.AIRELAY_TRANSCRIPTS_DIR;
  }
}

/**
 * Creates a minimal config file for testing.
 * Use this instead of running `airelay init` in tests.
 */
export function createTestConfig(configPath: string, profiles: Record<string, unknown> = {}): void {
  const config = {
    version: 1,
    profiles: {
      opencode: {
        executable: 'opencode',
        description: 'opencode profile',
        env: {
          OPENCODE_CONFIG_DIR: '/tmp/opencode-test',
        },
      },
      codex: {
        executable: 'codex',
        description: 'codex profile',
        env: {
          CODEX_CONFIG_DIR: '/tmp/codex-test',
        },
      },
      ...profiles,
    },
  };

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Jest hooks wrapper for test environment setup.
 * Automatically handles beforeAll/afterAll setup and cleanup.
 *
 * Usage:
 * ```ts
 * const testEnv = useTestEnv();
 *
 * // Now you can use testEnv.configPath in your tests
 * it('should work', () => {
 *   fs.writeFileSync(testEnv.configPath, '...');
 * });
 * ```
 */
export function useTestEnv(): TestEnv {
  const testEnv = setupTestEnv();

  beforeAll(() => {
    setupEnv(testEnv);
  });

  afterAll(() => {
    cleanupEnv(testEnv);
  });

  return testEnv;
}

/**
 * Creates a test harness home directory with specified files and directories.
 * Useful for testing isolation logic.
 *
 * @param baseDir - Path to the base directory (e.g., ~/.codex mock)
 * @param options - Files and directories to create
 */
export function createTestHarnessHome(
  baseDir: string,
  options: {
    files?: string[];
    dirs?: string[];
    fileContents?: Record<string, string>;
  } = {}
): void {
  fs.mkdirSync(baseDir, { recursive: true });

  if (options.files) {
    for (const file of options.files) {
      const filePath = path.join(baseDir, file);
      const content = options.fileContents?.[file] || JSON.stringify({ mock: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }

  if (options.dirs) {
    for (const dir of options.dirs) {
      const dirPath = path.join(baseDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
