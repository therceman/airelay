# Test Utilities

## Overview

The `test-utils.ts` module provides helper functions to create isolated test environments that **never touch your real `~/.airelay` directory**.

## Why?

**Problem:** Tests were accidentally overwriting the real config file at `~/.airelay/config.yaml`, deleting user profiles.

**Solution:** All tests now use temporary directories with isolated config files via environment variables.

## Usage

### Basic Pattern

```typescript
import { useTestEnv, createTestConfig } from './test-utils';

describe('MyCommand', () => {
  const testEnv = useTestEnv();

  beforeAll(() => {
    // Optionally create a default config
    createTestConfig(testEnv.configPath);
  });

  it('should work', () => {
    // Use testEnv.configPath instead of hardcoded paths
    fs.writeFileSync(testEnv.configPath, '...');

    // AIRELAY_CONFIG is automatically set to testEnv.configPath
    // Your real ~/.airelay is never touched
  });
});
```

### What It Does

The `useTestEnv()` hook:

1. **Creates temp directory**: `/tmp/airelay-test-<pid>-<timestamp>`
2. **Sets environment variables**:
   - `AIRELAY_CONFIG` → `<temp>/config.yaml`
   - `AIRELAY_SESSIONS` → `<temp>/sessions.json`
   - `AIRELAY_LAST_USED` → `<temp>/last-used`
   - `AIRELAY_PIDS` → `<temp>/pids.json`
3. **Cleans up automatically**: Removes temp directory after tests

### Helper Functions

#### `useTestEnv()`

Jest hooks wrapper that automatically sets up and tears down test environment.

```typescript
const testEnv = useTestEnv();
// Access: testEnv.configPath, testEnv.sessionsPath, etc.
```

#### `setupTestEnv()`

Manual setup without Jest hooks (for custom beforeAll/afterAll).

```typescript
const testEnv = setupTestEnv();

beforeAll(() => setupEnv(testEnv));
afterAll(() => cleanupEnv(testEnv));
```

#### `createTestConfig(configPath, profiles?)`

Creates a minimal config file with default profiles.

```typescript
createTestConfig(testEnv.configPath);

// Or with custom profiles
createTestConfig(testEnv.configPath, {
  myprofile: {
    executable: 'opencode',
    description: 'My custom profile',
  },
});
```

#### `setupEnv(env)` / `cleanupEnv(env)`

Manual environment setup/cleanup (used by `useTestEnv` internally).

## Migration Guide

### Before (❌ DANGEROUS)

```typescript
const testDir = path.join(os.tmpdir(), 'test-' + Date.now());
const configPath = path.join(testDir, 'config.yaml');

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true });
  process.env.AIRELAY_CONFIG = configPath;
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true });
  delete process.env.AIRELAY_CONFIG; // ❌ Might not restore original!
});
```

### After (✅ SAFE)

```typescript
const testEnv = useTestEnv();

beforeAll(() => {
  createTestConfig(testEnv.configPath);
});
```

## Benefits

1. **No config overwrites** - Real `~/.airelay` is never touched
2. **Less boilerplate** - One line instead of 20+ lines of setup
3. **Automatic cleanup** - Temp files removed even if tests crash
4. **Consistent isolation** - All AIUSE\_\* vars are isolated
5. **Parallel-safe** - Each test suite gets unique temp directory

## Rules

1. **NEVER** access `~/.airelay` directly in tests
2. **ALWAYS** use `testEnv.configPath` (or other paths)
3. **ALWAYS** use `useTestEnv()` in new test files
4. **NEVER** assume a specific config exists - create it explicitly

## Examples

### Full Test File

```typescript
import { runCommand } from '../src/commands/run';
import { useTestEnv, createTestConfig } from './test-utils';
import fs from 'fs';

describe('runCommand', () => {
  const testEnv = useTestEnv();

  beforeAll(() => {
    createTestConfig(testEnv.configPath, {
      testprofile: {
        executable: 'echo',
        args: ['hello'],
      },
    });
  });

  it('runs profile', async () => {
    const exitCode = await runCommand('testprofile', []);
    expect(exitCode).toBe(0);
  });
});
```

### Custom Setup

```typescript
import { setupTestEnv, setupEnv, cleanupEnv } from './test-utils';

describe('CustomTest', () => {
  const testEnv = setupTestEnv();

  beforeAll(() => {
    setupEnv(testEnv);
    // Custom setup
    fs.writeFileSync(testEnv.configPath, 'custom config...');
  });

  afterAll(() => {
    cleanupEnv(testEnv);
  });

  it('works', () => {
    // Tests here use isolated config
  });
});
```

## Debugging

Use `performance.now()` for elapsed-time assertions and real-time polling
deadlines: wall-clock adjustments in a VM/WSL must not change a test's timeout
or measured latency. Keep `Date.now()` for epoch timestamps and unique fixture
names. Wait for observable readiness before asking a fixture child to exit;
use timers as bounded watchdogs, not as proof that an event already occurred.

If a test is still touching your real config:

1. Check that `useTestEnv()` is called at the top of the describe block
2. Verify no hardcoded `~/.airelay` paths in the test
3. Check that all `execSync` calls pass `env: { ...process.env, AIRELAY_CONFIG: testEnv.configPath }`
4. Look for missing `useTestEnv()` in nested describe blocks

## Implementation Details

- Temp directory includes PID and timestamp for uniqueness
- All 4 AIUSE\_\* environment variables are isolated
- Original env vars are restored in afterAll
- Cleanup uses `force: true` to handle missing files gracefully
- Test directories are in OS temp folder (auto-cleaned on reboot)
