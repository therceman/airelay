import path from 'path';
import { SessionController } from '../src/controller';
import { tailCommand } from '../src/commands/tail';
import { addSession, removeSessionByKey } from '../src/commands/sessions';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

async function runTail(
  sessionKey: string,
  feed: string | string[],
  options?: { lines?: number; skip?: number; json?: boolean },
  rows = 30
): Promise<{ exitCode: number; logs: string[] }> {
  const controller = new SessionController(sessionKey);
  expect(path.dirname(controller.endpointPath)).toBe(testEnv.socketsDir);
  controller.resize(120, rows);
  for (const chunk of Array.isArray(feed) ? feed : [feed]) {
    controller.feedOutput(chunk);
  }
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

  it('falls back to rendered scrollback when the viewport is too small', async () => {
    const sessionKey = 'tail_small_viewport';
    const controller = new SessionController(sessionKey);
    controller.resize(120, 3);
    let out = '';
    for (let i = 0; i < 50; i++) out += `line ${i}\r\n`;
    controller.feedOutput(out);
    await controller.flushViewport();
    controller.onRequest(async () => ({ handled: false }));
    await controller.start();
    addSession('e2e-profile', `ses_${sessionKey}`, undefined, sessionKey, controller.endpointPath);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      expect(await tailCommand(sessionKey, { lines: 5, skip: 3 })).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual(['line 42', 'line 43', 'line 44', 'line 45', 'line 46']);
    await controller.stop();
    removeSessionByKey(sessionKey);
  });

  it('uses rendered scrollback when a logical line is split across PTY chunks', async () => {
    const { exitCode, logs } = await runTail(
      'tail_split_line',
      ['hel', 'lo\r\nworld\r\nnext\r\n'],
      { lines: 3 },
      2
    );

    expect(exitCode).toBe(0);
    expect(logs).toEqual(['hello', 'world', 'next']);
  });
});
