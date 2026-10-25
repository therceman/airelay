import { EventEmitter } from 'node:events';
import * as nativePty from 'node-pty';
import { createPty } from '../src/runtime/pty';
import { useTestEnv } from './test-utils';

jest.mock('node-pty', () => ({ spawn: jest.fn() }));
useTestEnv();

class TerminalSource extends EventEmitter {
  isTTY = true;
  columns = 143;
  rows = 42;
}
let output: (data: string) => void;
let exit: (event: { exitCode: number }) => void;
const resize = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 0, 1) });
  (nativePty.spawn as jest.Mock).mockReturnValue({
    pid: 123,
    write: jest.fn(),
    resize,
    kill: () => exit({ exitCode: 0 }),
    onData: (callback: typeof output) => {
      output = callback;
    },
    onExit: (callback: typeof exit) => {
      exit = callback;
    },
  });
});
afterEach(() => {
  exit?.({ exitCode: 0 });
  jest.useRealTimers();
});
const advance = (ms: number) => jest.advanceTimersByTime(ms);

it('holds spaced resize oscillation after early output until startup grace expires', () => {
  const source = new TerminalSource();
  createPty({
    file: 'unused',
    args: [],
    resizeSource: source,
    resizeStartupGraceMs: 700,
    onForegroundOutput: () => undefined,
  });
  expect(nativePty.spawn).toHaveBeenCalledWith(
    'unused',
    [],
    expect.objectContaining({ cols: 143, rows: 42 })
  );
  advance(100);
  output('ready');
  advance(50);
  for (const row of [41, 42, 41, 42, 41]) {
    source.rows = row;
    source.emit('resize');
    expect(resize).not.toHaveBeenCalled();
    advance(100);
  }
  advance(49);
  expect(resize).not.toHaveBeenCalled();
  advance(1);
  expect(resize.mock.calls).toEqual([[143, 41]]);
});
it('does not forward startup oscillation when the final size equals the initial size', () => {
  const source = new TerminalSource();
  createPty({
    file: 'unused',
    args: [],
    resizeSource: source,
    resizeStartupGraceMs: 700,
    onForegroundOutput: () => undefined,
  });
  advance(100);
  output('ready');
  advance(50);
  for (const row of [41, 42, 41, 42]) {
    source.rows = row;
    source.emit('resize');
    advance(100);
  }
  advance(300);
  expect(resize).not.toHaveBeenCalled();
});
it.each([41, 42])(
  'stabilizes detached public resize requests during startup (final rows %i)',
  (finalRows) => {
    const source = new TerminalSource();
    const terminal = createPty({
      file: 'unused',
      args: [],
      resizeSource: source,
      detached: true,
      resizeStartupGraceMs: 700,
      resizeStartupQuietMs: 200,
      resizeStartupMaxMs: 1500,
    });
    advance(100);
    output('ready');
    advance(50);
    for (const row of [41, 42, 41, finalRows]) {
      terminal.requestExternalResize(143, row);
      expect(resize).not.toHaveBeenCalled();
      advance(110);
    }
    advance(109);
    expect(resize).not.toHaveBeenCalled();
    advance(1);
    expect(resize.mock.calls).toEqual(finalRows === 42 ? [] : [[143, 41]]);
    expect(source.listenerCount('resize')).toBe(0);
  }
);
it('holds external resize past the minimum grace while replay output continues', () => {
  const terminal = createPty({
    file: 'unused',
    args: [],
    detached: true,
    resizeStartupGraceMs: 400,
    resizeStartupQuietMs: 250,
    resizeStartupMaxMs: 3000,
  });
  for (let i = 1; i <= 14; i++) {
    advance(100);
    output('replay');
    if (i === 11) terminal.requestExternalResize(160, 50);
    expect(resize).not.toHaveBeenCalled();
  }
  advance(249);
  expect(resize).not.toHaveBeenCalled();
  advance(1);
  expect(resize.mock.calls).toEqual([[160, 50]]);
});
it('bounds a pending resize during continuous output by the absolute startup maximum', () => {
  const terminal = createPty({
    file: 'unused',
    args: [],
    detached: true,
    resizeStartupGraceMs: 400,
    resizeStartupQuietMs: 250,
    resizeStartupMaxMs: 1500,
  });
  for (let i = 1; i <= 14; i++) {
    advance(100);
    output('replay');
    if (i === 11) terminal.requestExternalResize(160, 50);
    expect(resize).not.toHaveBeenCalled();
  }
  advance(99);
  expect(resize).not.toHaveBeenCalled();
  advance(1);
  expect(resize.mock.calls).toEqual([[160, 50]]);
});
it('keeps ordinary debounce and identical-dimension dedupe after startup', () => {
  const terminal = createPty({
    file: 'unused',
    args: [],
    detached: true,
    cols: 143,
    rows: 42,
    resizeStartupGraceMs: 700,
  });
  terminal.requestExternalResize(143, 42);
  advance(700);
  expect(resize).not.toHaveBeenCalled();
  terminal.requestExternalResize(160, 50);
  advance(74);
  expect(resize).not.toHaveBeenCalled();
  advance(1);
  expect(resize.mock.calls).toEqual([[160, 50]]);
  terminal.requestExternalResize(160, 50);
  advance(75);
  expect(resize.mock.calls).toEqual([[160, 50]]);
});
it('cancels startup resize timers, pending requests and parent listeners on exit', async () => {
  const source = new TerminalSource();
  const terminal = createPty({ file: 'unused', args: [], resizeSource: source });
  source.rows = 41;
  source.emit('resize');
  expect(jest.getTimerCount()).toBe(1);
  terminal.kill();
  expect(await terminal.exitCode).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  expect(source.listenerCount('resize')).toBe(0);
  advance(10000);
  expect(resize).not.toHaveBeenCalled();
});
