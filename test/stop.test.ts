import fs from 'fs';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { stopCommand } from '../src/commands/stop';
import { findDetachedBySessionKey } from '../src/runtime/detached-registry';
import { useTestEnv } from './test-utils';

describe('stop detached runtime', () => {
  const testEnv = useTestEnv();

  it('stops only the identity-matched detached runtime and lets it clean up its registry/socket', async () => {
    const key = 'stop_test';
    const harnessPath = path.join(testEnv.testDir, 'stop-harness');
    fs.writeFileSync(
      harnessPath,
      '#!/usr/bin/env node\nprocess.stdout.write("ready\\r\\n"); setInterval(() => {}, 1000);\n'
    );
    fs.chmodSync(harnessPath, 0o755);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { stoppro: { executable: harnessPath } },
      })
    );

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const runtimePromise = runCommand('stoppro', [], {
      usePty: true,
      detached: true,
      sessionKey: key,
      onDetachedReady: resolveStarted,
    });

    try {
      await started;
      expect(findDetachedBySessionKey(key)).not.toBeNull();
      await expect(stopCommand(key)).resolves.toBe(0);
      await expect(runtimePromise).resolves.toBeDefined();
      expect(findDetachedBySessionKey(key)).toBeNull();
    } finally {
      if (findDetachedBySessionKey(key)) {
        await stopCommand(key);
      }
      await runtimePromise;
    }
  }, 15000);
});
