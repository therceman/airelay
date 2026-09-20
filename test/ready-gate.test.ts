import fs from 'fs';
import net from 'net';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { stopCommand } from '../src/commands/stop';
import { findDetachedBySessionKey } from '../src/runtime/detached-registry';
import {
  READY_INPUT_FAIL_OPEN_MS,
  READY_PROMPT_IPC_TIMEOUT_MS,
} from '../src/runtime/harness-ready';
import { readLines } from '../src/controller/protocol';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

interface InputResponse {
  type: string;
  data?: { deliveryId?: string };
}

function sendInput(endpoint: string, text: string, deliveryId: string): Promise<InputResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('session.input timed out'));
    }, 20000);

    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          id: 'input-test',
          method: 'session.input',
          params: { text, deliveryId, enter: true },
        }) + '\n'
      );
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = readLines(buffer + chunk.toString(), (line) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(JSON.parse(line) as InputResponse);
      });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForEndpoint(get: () => string): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const endpoint = get();
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for controller endpoint');
}

function writeHarness(name: string, body: string): string {
  const harnessPath = path.join(testEnv.testDir, name);
  fs.writeFileSync(harnessPath, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(harnessPath, 0o755);
  return harnessPath;
}

function writeConfig(profileName: string, executable: string): void {
  fs.writeFileSync(
    testEnv.configPath,
    JSON.stringify({
      version: 1,
      settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
      profiles: { [profileName]: { executable } },
    })
  );
}

interface InputEvent {
  data: string;
  footerShown?: boolean;
}

function readInputEvents(inputLogPath: string): InputEvent[] {
  return fs
    .readFileSync(inputLogPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as InputEvent);
}

describe('harness readiness gate for session.input', () => {
  it('accepts the current Devin M-capacity footer before command prompt delivery', async () => {
    const inputLogPath = path.join(testEnv.testDir, 'devin-ready-input.log');
    const harnessPath = writeHarness(
      'devin-ready-harness',
      `const fs = require('fs');
process.stdout.write('Trust already resolved\\r\\n');
setTimeout(() => process.stdout.write('\\x1b[30;1HContext: 11k / 1.0M tokens (1%)'), 600);
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, chunk.toString());
  if (chunk.includes('\\r')) process.exit(0);
});
setInterval(() => {}, 50);`
    );
    writeConfig('devinready', harnessPath);

    let endpoint = '';
    const runPromise = runCommand('devinready', [], {
      usePty: true,
      detached: true,
      sessionKey: 'devin_ready_gate',
      readyTimeoutMs: 3000,
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    try {
      const socket = await waitForEndpoint(() => endpoint);
      const sentAt = performance.now();
      const response = await sendInput(socket, 'ready-gated Devin prompt', 'devin-ready-1');
      expect(performance.now() - sentAt).toBeLessThan(2000);
      expect(response.type).toBe('success');
      await expect(runPromise).resolves.toBe(0);
      expect(fs.readFileSync(inputLogPath, 'utf8')).toContain('ready-gated Devin prompt');
      expect(READY_PROMPT_IPC_TIMEOUT_MS).toBeGreaterThan(READY_INPUT_FAIL_OPEN_MS);
    } finally {
      if (findDetachedBySessionKey('devin_ready_gate')) {
        await stopCommand('devin_ready_gate');
      }
      await runPromise;
    }
  }, 15000);

  it('holds prompt delivery until the ready footer appears in the viewport', async () => {
    const inputLogPath = path.join(testEnv.testDir, 'ready-input.log');
    const harnessPath = writeHarness(
      'codex-ready-harness',
      `const fs = require('fs');
let footerShown = false;
process.stdout.write('loading session…\\r\\n');
setTimeout(() => {
  footerShown = true;
  process.stdout.write('\\x1b[30;1H' + 'gpt · Context 90% left · ~/x');
}, 600);
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
// Program-order check (not wall-clock): the flag flips before the footer is
// drawn, so any input logged with footerShown=false arrived before the gate.
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, JSON.stringify({ data: chunk.toString(), footerShown }) + '\\n');
  if (chunk.includes('\\r')) process.exit(0);
});
setInterval(() => {}, 50);`
    );
    writeConfig('readypro', harnessPath);

    let endpoint = '';
    const runPromise = runCommand('readypro', [], {
      usePty: true,
      detached: true,
      sessionKey: 'ready_gate_pattern',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const socket = await waitForEndpoint(() => endpoint);
    const response = await sendInput(socket, 'gated prompt body', 'ready-gated-1');
    expect(response.type).toBe('success');

    await expect(runPromise).resolves.toBe(0);
    const inputEvents = readInputEvents(inputLogPath);
    expect(inputEvents.length).toBeGreaterThanOrEqual(1);
    // Every delivered chunk must have arrived only after the harness rendered
    // its ready footer — the gate held while the footer was absent.
    expect(inputEvents.every((event) => event.footerShown)).toBe(true);
    expect(inputEvents.map((event) => event.data).join('')).toContain('gated prompt body');
  }, 20000);

  it('fails open after the ready timeout when no footer ever appears', async () => {
    const inputLogPath = path.join(testEnv.testDir, 'failopen-input.log');
    const harnessPath = writeHarness(
      'codex-nofooter-harness',
      `const fs = require('fs');
process.stdout.write('loading session…\\r\\n');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, JSON.stringify({ data: chunk.toString() }) + '\\n');
  if (chunk.includes('\\r')) process.exit(0);
});
setInterval(() => {}, 50);`
    );
    writeConfig('failopenpro', harnessPath);

    let endpoint = '';
    const runPromise = runCommand('failopenpro', [], {
      usePty: true,
      detached: true,
      sessionKey: 'ready_gate_failopen',
      readyTimeoutMs: 500,
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const socket = await waitForEndpoint(() => endpoint);
    // Monotonic clock on this side of the IPC: the response only arrives once
    // the prompt is actually written, so elapsed time measures the gate hold
    // without trusting wall-clock timestamps across processes.
    const sentAt = performance.now();
    const response = await sendInput(socket, 'fail-open prompt', 'ready-failopen-1');
    const elapsed = performance.now() - sentAt;
    expect(response.type).toBe('success');

    await expect(runPromise).resolves.toBe(0);
    const inputEvents = readInputEvents(inputLogPath);
    expect(inputEvents.map((event) => event.data).join('')).toContain('fail-open prompt');
    // Delivered only after the 500ms fail-open bound — never instantly, never
    // hung forever.
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(10000);
  }, 20000);

  it('delivers immediately for harnesses without a ready pattern', async () => {
    const inputLogPath = path.join(testEnv.testDir, 'plain-input.log');
    const harnessPath = writeHarness(
      'plain-input-harness',
      `const fs = require('fs');
process.stdout.write('plain harness\\r\\n');
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, JSON.stringify({ data: chunk.toString() }) + '\\n');
  if (chunk.includes('\\r')) process.exit(0);
});
setInterval(() => {}, 50);`
    );
    writeConfig('plainpro', harnessPath);

    let endpoint = '';
    const runPromise = runCommand('plainpro', [], {
      usePty: true,
      detached: true,
      sessionKey: 'ready_gate_plain',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const socket = await waitForEndpoint(() => endpoint);
    const sentAt = performance.now();
    const response = await sendInput(socket, 'plain prompt', 'ready-plain-1');
    const elapsed = performance.now() - sentAt;
    expect(response.type).toBe('success');

    await expect(runPromise).resolves.toBe(0);
    const inputEvents = readInputEvents(inputLogPath);
    expect(inputEvents.map((event) => event.data).join('')).toContain('plain prompt');
    expect(elapsed).toBeLessThan(2000);
  }, 20000);
});
