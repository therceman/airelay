import fs from 'fs';
import net from 'net';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { stopCommand } from '../src/commands/stop';
import {
  addDetachedEntry,
  findDetachedBySessionKey,
  removeDetachedEntry,
} from '../src/runtime/detached-registry';
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

  it('stops an identity-matched runtime whose controller predates session.stop', async () => {
    const runtimeId = 'legacy-runtime';
    const sessionKey = 'legacy-stop';
    const endpoint = path.join(testEnv.testDir, 'legacy-controller.sock');
    const entry = {
      runtimeId,
      sessionKey,
      profile: 'codex',
      cwd: testEnv.testDir,
      runtimePid: process.pid,
      agentPid: process.pid,
      controllerEndpoint: endpoint,
      startedAt: Date.now(),
      attachedClients: 0,
    };
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write(
          JSON.stringify({
            type: 'success',
            data: {
              airelayVersion: '0.1.154',
              controllerProtocolVersion: 2,
              runtime: { runtimeId, controllerPid: process.pid },
            },
          }) + '\n'
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    addDetachedEntry(entry);

    const originalKill = process.kill.bind(process);
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === process.pid && signal === 'SIGTERM') {
        removeDetachedEntry(runtimeId);
        return true;
      }
      return originalKill(pid, signal as NodeJS.Signals);
    });

    try {
      await expect(stopCommand(sessionKey)).resolves.toBe(0);
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(findDetachedBySessionKey(sessionKey)).toBeNull();
    } finally {
      killSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(endpoint);
      } catch {
        // The platform may remove the socket path when the server closes.
      }
    }
  });
});
