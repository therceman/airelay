import net from 'net';
import fs from 'fs';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { readLines } from '../src/controller/protocol';
import { readLatestRuntimeDiagnostic } from '../src/runtime/diagnostics';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

interface IpcResponse {
  type: string;
  data?: { lines?: string[] };
}

function request(endpoint: string, method: string): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`IPC request timed out: ${method}`));
    }, 2000);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: `test-${Date.now()}`, method }) + '\n');
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = readLines(buffer + chunk.toString(), (line) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.parse(line) as IpcResponse);
      });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendRaw(endpoint: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, 100);
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          id: `raw-${Date.now()}`,
          method: 'session.input.raw',
          params: { data },
        }) + '\n'
      );
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendPrompt(endpoint: string, text: string): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('session.input timed out'));
    }, 15000);

    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          id: `prompt-${Date.now()}`,
          method: 'session.input',
          params: { text, deliveryId: 'devin-wake-prompt-test', enter: true },
        }) + '\n'
      );
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = readLines(buffer + chunk.toString(), (line) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.parse(line) as IpcResponse);
      });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendResize(endpoint: string, cols: number, rows: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, 100);
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          id: `resize-${Date.now()}`,
          method: 'session.resize',
          params: { cols, rows },
        }) + '\n'
      );
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForHibernatedScreen(endpoint: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await request(endpoint, 'session.viewport');
    if (response.data?.lines?.some((line) => line.includes('Agent hibernated'))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for hibernated screen');
}

function readStoredRuntime(): Record<string, unknown> {
  const sessions = JSON.parse(fs.readFileSync(testEnv.sessionsPath, 'utf8')) as {
    sleeper?: Array<Record<string, unknown>>;
  };
  return sessions.sleeper?.[0] || {};
}

async function waitForStoredRuntimeState(
  profile: string,
  sessionKey: string,
  expectedState: string,
  timeoutMs = 15000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const sessions = JSON.parse(fs.readFileSync(testEnv.sessionsPath, 'utf8')) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      const runtime = sessions[profile]?.find((entry) => entry.sessionKey === sessionKey);
      if (runtime?.runtimeState === expectedState) return;
    } catch {
      // The registry may be between atomic writes; retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${profile}/${sessionKey} to reach ${expectedState}`);
}

describe('automatic hibernation', () => {
  const originalLog = console.log;
  const harnessPath = path.join(testEnv.testDir, 'codex-wake-test');
  const argsLogPath = path.join(testEnv.testDir, 'codex-args.log');
  const sizeLogPath = path.join(testEnv.testDir, 'codex-size.log');

  beforeEach(() => {
    fs.writeFileSync(
      harnessPath,
      `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.AIRELAY_TEST_ARGS_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.appendFileSync(process.env.AIRELAY_TEST_SIZE_LOG, JSON.stringify([process.stdout.columns, process.stdout.rows]) + '\\n');
setTimeout(() => process.stdout.write('heartbeat\\n'), 50);
setInterval(() => {}, 50);
`
    );
    fs.chmodSync(harnessPath, 0o755);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: {
          promptMaxLength: -1,
          hibernateAfter: '1s',
          harnessSelfUpdate: true,
        },
        profiles: {
          sleeper: {
            executable: harnessPath,
            env: { AIRELAY_TEST_ARGS_LOG: argsLogPath, AIRELAY_TEST_SIZE_LOG: sizeLogPath },
          },
        },
      })
    );
    console.log = jest.fn();
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('shows the idle screen and wakes the same resumable launch', async () => {
    const config = JSON.parse(fs.readFileSync(testEnv.configPath, 'utf8')) as {
      settings: { hibernateAfter: string };
    };
    config.settings.hibernateAfter = '6s';
    fs.writeFileSync(testEnv.configPath, JSON.stringify(config));

    let endpoint = '';
    const runPromise = runCommand('sleeper', ['resume', 'native-session'], {
      usePty: true,
      detached: true,
      sessionKey: 'sleeper_test',
      harnessSelfUpdate: false,
      profileSessionId: 'native-session',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const deadline = Date.now() + 2000;
    while (!endpoint && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(endpoint).toBeTruthy();

    await sendResize(endpoint, 100, 40);
    await new Promise((resolve) => setTimeout(resolve, 5200));
    const beforeConfiguredHibernate = await request(endpoint, 'session.viewport');
    expect(beforeConfiguredHibernate.data?.lines?.join(' ')).not.toContain('Agent hibernated');
    await waitForHibernatedScreen(endpoint);
    const hibernated = readStoredRuntime();
    expect(hibernated.runtimeState).toBe('hibernated');
    expect(hibernated.controllerPid).toBe(process.pid);
    expect(hibernated.harnessPid).toBeNull();
    const runtimeId = hibernated.runtimeId;
    expect(typeof runtimeId).toBe('string');
    await sendRaw(endpoint, '\x1b[<0;10;20M');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readStoredRuntime().runtimeState).toBe('hibernated');
    await sendRaw(endpoint, '\x1b[I');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readStoredRuntime().runtimeState).toBe('hibernated');
    await sendRaw(endpoint, 'x');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readStoredRuntime().runtimeState).toBe('hibernated');

    await sendRaw(endpoint, ' ');
    const argsDeadline = Date.now() + 2000;
    while (Date.now() < argsDeadline) {
      if (
        fs.existsSync(argsLogPath) &&
        fs.readFileSync(argsLogPath, 'utf-8').trim().split('\n').length >= 2
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const sizeDeadline = Date.now() + 2000;
    while (Date.now() < sizeDeadline) {
      if (
        fs.existsSync(sizeLogPath) &&
        fs.readFileSync(sizeLogPath, 'utf-8').trim().split('\n').length >= 2
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const launches = fs
      .readFileSync(argsLogPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(launches.slice(0, 2)).toEqual([
      ['-c', 'check_for_update_on_startup=false', 'resume', 'native-session'],
      ['-c', 'check_for_update_on_startup=false', 'resume', 'native-session'],
    ]);
    const sizes = fs
      .readFileSync(sizeLogPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as number[]);
    // The resize request may arrive after the first PTY has already been
    // spawned. The onPtyReady reconciliation applies the controller's desired
    // size before the resumed generation starts.
    expect(sizes.slice(0, 2)).toEqual([
      [120, 30],
      [100, 40],
    ]);
    const running = readStoredRuntime();
    expect(running.runtimeState).toBe('running');
    expect(running.controllerPid).toBe(process.pid);
    expect(running.harnessPid).toEqual(expect.any(Number));
    expect(running.runtimeId).toBe(runtimeId);
    await sendRaw(endpoint, '\u0003');

    await expect(runPromise).resolves.toBeDefined();
    const trace = readLatestRuntimeDiagnostic('sleeper_test');
    expect(trace?.events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'runtime_start',
        'resume_start',
        'pty_spawn',
        'pty_exit',
        'runtime_stop',
      ])
    );
  }, 25000);

  it('waits for the foreground resume presentation before injecting a wake prompt', async () => {
    const foregroundHarnessPath = path.join(testEnv.testDir, 'devin-wake-prompt');
    const generationPath = path.join(testEnv.testDir, 'devin-generation');
    const inputPath = path.join(testEnv.testDir, 'devin-wake-input.log');
    fs.writeFileSync(
      foregroundHarnessPath,
      `#!/usr/bin/env node
const fs = require('fs');
const generationPath = ${JSON.stringify(generationPath)};
const inputPath = ${JSON.stringify(inputPath)};
const generation = Number(fs.existsSync(generationPath) ? fs.readFileSync(generationPath, 'utf8') : 0) + 1;
fs.writeFileSync(generationPath, String(generation));
if (generation > 1) process.stdout.write('resume-hydration\\r\\n');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(inputPath, JSON.stringify({ at: Date.now(), data: chunk.toString() }) + '\\n');
  if (chunk.includes('\\r') || chunk.includes('\\u0003')) process.exit(0);
});
setInterval(() => {}, 50);
`
    );
    fs.chmodSync(foregroundHarnessPath, 0o755);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { promptMaxLength: -1, hibernateAfter: '3s', harnessSelfUpdate: true },
        profiles: { devin: { executable: foregroundHarnessPath } },
      })
    );

    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 30 });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let endpoint = '';
    let runPromise: Promise<number> | undefined;
    let runCompleted = false;

    try {
      runPromise = runCommand('devin', ['--resume', 'native-session'], {
        usePty: true,
        sessionKey: 'devin_wake_prompt_test',
        profileSessionId: 'native-session',
        harnessSelfUpdate: false,
        onSessionStart: (info) => {
          endpoint = info.controllerEndpoint;
        },
      }).finally(() => {
        runCompleted = true;
      });

      const endpointDeadline = Date.now() + 2000;
      while (!endpoint && Date.now() < endpointDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(endpoint).toBeTruthy();
      await waitForStoredRuntimeState('devin', 'devin_wake_prompt_test', 'hibernated');
      const hibernatedScreen = await request(endpoint, 'session.viewport');
      expect(hibernatedScreen.data?.lines?.join(' ')).toContain('Agent hibernated');

      const requestStartedAt = Date.now();
      const promptPromise = sendPrompt(endpoint, 'wake prompt body');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fs.existsSync(inputPath)).toBe(false);

      await expect(promptPromise).resolves.toMatchObject({ type: 'success' });
      await expect(runPromise).resolves.toBe(0);
      const inputEvents = fs
        .readFileSync(inputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { at: number; data: string });
      expect(inputEvents.map((event) => event.data).join('')).toContain('wake prompt body');
      expect(inputEvents[0].at - requestStartedAt).toBeGreaterThanOrEqual(700);
    } finally {
      if (runPromise && !runCompleted && endpoint) {
        await sendRaw(endpoint, ' ').catch(() => undefined);
        await sendRaw(endpoint, '\u0003').catch(() => undefined);
        await Promise.race([runPromise, new Promise((resolve) => setTimeout(resolve, 2000))]);
      }
      writeSpy.mockRestore();
      if (isTTY) Object.defineProperty(process.stdout, 'isTTY', isTTY);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
      if (stdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      if (columns) Object.defineProperty(process.stdout, 'columns', columns);
      else Reflect.deleteProperty(process.stdout, 'columns');
      if (rows) Object.defineProperty(process.stdout, 'rows', rows);
      else Reflect.deleteProperty(process.stdout, 'rows');
    }
  }, 45000);
});
