import net from 'net';
import fs from 'fs';
import { runCommand } from '../src/commands/run';
import { readLines } from '../src/controller/protocol';
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

async function waitForHibernatedScreen(endpoint: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const response = await request(endpoint, 'session.viewport');
    if (response.data?.lines?.some((line) => line.includes('Agent hibernated'))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for hibernated screen');
}

describe('automatic hibernation', () => {
  const originalLog = console.log;

  beforeEach(() => {
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { promptMaxLength: -1, hibernateAfter: '1s' },
        profiles: {
          sleeper: {
            executable: 'node',
            args: ['-e', "setInterval(() => process.stdout.write('heartbeat\\n'), 50)"],
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
    let endpoint = '';
    const runPromise = runCommand('sleeper', ['resume', 'native-session'], {
      usePty: true,
      detached: true,
      sessionKey: 'sleeper_test',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const deadline = Date.now() + 2000;
    while (!endpoint && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(endpoint).toBeTruthy();

    await waitForHibernatedScreen(endpoint);
    await sendRaw(endpoint, 'wake');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await sendRaw(endpoint, '\u0003');

    await expect(runPromise).resolves.toBeDefined();
  }, 10000);
});
