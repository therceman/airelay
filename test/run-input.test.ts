import fs from 'fs';
import net from 'net';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { readLines } from '../src/controller/protocol';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

interface InputResponse {
  type: string;
  data?: { deliveryId?: string };
}

function sendInput(endpoint: string): Promise<InputResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('session.input timed out'));
    }, 2000);

    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          id: 'input-test',
          method: 'session.input',
          params: {
            text: 'resume input',
            deliveryId: 'resume-input-test',
            enter: '\r',
            submitDelayMs: 25,
          },
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

describe('command-driven input after resume', () => {
  it('submits without waiting for a harness-specific input marker', async () => {
    const harnessPath = path.join(testEnv.testDir, 'codex-input-harness');
    const inputLogPath = path.join(testEnv.testDir, 'input.log');
    fs.writeFileSync(
      harnessPath,
      `#!/usr/bin/env node
const fs = require('fs');
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, JSON.stringify(chunk.toString()) + '\\n');
  if (chunk.includes('\\r') || chunk.includes('\\n')) process.exit(0);
});
setTimeout(() => process.exit(2), 1500);
`
    );
    fs.chmodSync(harnessPath, 0o755);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { resume_input: { executable: harnessPath } },
      })
    );

    let endpoint = '';
    const runPromise = runCommand('resume_input', [], {
      usePty: true,
      detached: true,
      sessionKey: 'resume_input_test',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const deadline = Date.now() + 1000;
    while (!endpoint && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(endpoint).toBeTruthy();

    const response = await sendInput(endpoint);
    expect(response.type).toBe('success');
    expect(response.data?.deliveryId).toBe('resume-input-test');

    await expect(runPromise).resolves.toBe(0);
    const writes = fs
      .readFileSync(inputLogPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string)
      .join('');
    expect(writes).toContain('resume input');
    expect(writes).toContain('\u2063\u200b\u2063');
    expect(writes.includes('\r') || writes.includes('\n')).toBe(true);
  }, 10000);
});
