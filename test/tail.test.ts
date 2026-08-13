import path from 'path';
import { SessionController } from '../src/controller';
import { tailCommand } from '../src/commands/tail';
import { addSession, removeSessionByKey } from '../src/commands/sessions';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

async function runTail(
  sessionKey: string,
  feed: string,
  options?: { lines?: number; skip?: number; json?: boolean }
): Promise<{ exitCode: number; logs: string[] }> {
  const controller = new SessionController(sessionKey);
  expect(path.dirname(controller.endpointPath)).toBe(testEnv.socketsDir);
  controller.feedOutput(feed);
  await controller.flushViewport();
  controller.onRequest(async () => ({ handled: false }));
  await controller.start();
  addSession('e2e-profile', `ses_${sessionKey}`, undefined, sessionKey, controller.endpointPath);

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  let exitCode: number;
  try {
    exitCode = await tailCommand(sessionKey, options);
  } finally {
    console.log = originalLog;
  }

  await controller.stop();
  removeSessionByKey(sessionKey);
  return { exitCode, logs };
}

describe('tailCommand', () => {
  it('tail --lines returns the last N non-empty lines from the live viewport', async () => {
    let out = '';
    for (let i = 0; i < 50; i++) out += `line ${i}\r\n`;

    const { exitCode, logs } = await runTail('tail_lines', out, { lines: 5 });

    expect(exitCode).toBe(0);
    expect(logs).toEqual(['line 45', 'line 46', 'line 47', 'line 48', 'line 49']);
  });

  it('tail --skip excludes the trailing lines from the live viewport output', async () => {
    let out = '';
    for (let i = 0; i < 50; i++) out += `line ${i}\r\n`;

    const { exitCode, logs } = await runTail('tail_skip', out, { lines: 5, skip: 3 });

    expect(exitCode).toBe(0);
    expect(logs).toEqual(['line 42', 'line 43', 'line 44', 'line 45', 'line 46']);
  });

  it('tail skips blank rows in the live viewport output', async () => {
    const { exitCode, logs } = await runTail(
      'tail_blank',
      'alpha\r\n\r\nbravo\r\ncharlie\r\ndelta\r\n',
      {
        lines: 10,
      }
    );

    expect(exitCode).toBe(0);
    expect(logs).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(logs.some((l) => l.trim() === '')).toBe(false);
  });
});
