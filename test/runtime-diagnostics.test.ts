import fs from 'fs';
import path from 'path';
import { createPty } from '../src/runtime/pty';
import {
  getRuntimeDiagnosticsDir,
  MAX_RUNTIME_DIAGNOSTIC_EVENTS,
  MAX_RUNTIME_DIAGNOSTIC_FILES,
  PTY_OUTPUT_AGGREGATION_MS,
  readLatestRuntimeDiagnostic,
  RuntimeDiagnostics,
} from '../src/runtime/diagnostics';
import { sessionDebugCommand } from '../src/commands/session-debug';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readTraceFile(traceFile: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(traceFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('runtime PTY diagnostics', () => {
  it('writes bounded metadata-only JSONL in event order', () => {
    const diagnostics = RuntimeDiagnostics.start('trace_order');
    for (let index = 0; index < MAX_RUNTIME_DIAGNOSTIC_EVENTS + 10; index++) {
      diagnostics.recordPtyOutput(index + 1);
    }
    diagnostics.close();

    const trace = readLatestRuntimeDiagnostic('trace_order');
    expect(trace).not.toBeNull();
    expect(trace!.events.length).toBeLessThanOrEqual(MAX_RUNTIME_DIAGNOSTIC_EVENTS);
    expect(trace!.events[0].event).toBe('runtime_start');
    expect(trace!.events[1].event).toBe('resume_start');
    expect(trace!.events.at(-1)).toMatchObject({
      event: 'pty_output',
      bytes: ((MAX_RUNTIME_DIAGNOSTIC_EVENTS + 10) * (MAX_RUNTIME_DIAGNOSTIC_EVENTS + 11)) / 2,
      chunks: MAX_RUNTIME_DIAGNOSTIC_EVENTS + 10,
    });
    expect(readTraceFile(trace!.traceFile).join('')).not.toContain('trace_order');
  });

  it('coalesces high-volume output and preserves structural events', () => {
    const diagnostics = RuntimeDiagnostics.start('trace_saturation');
    diagnostics.recordPtySpawn(143, 42);
    for (let index = 0; index < 1000; index += 1) {
      diagnostics.recordPtyOutput(1);
    }
    diagnostics.recordResizeRequested(143, 41);
    diagnostics.recordResizeHeld(143, 41);
    diagnostics.recordStartupMaxReached();
    diagnostics.recordStartupStabilized('absolute_max');
    diagnostics.recordResizeForwarded(143, 41);
    diagnostics.recordPtyExit(0);
    diagnostics.recordRuntimeStop('exited');
    diagnostics.close();

    const trace = readLatestRuntimeDiagnostic('trace_saturation')!;
    const events = trace.events;
    const outputEvents = events.filter((event) => event.event === 'pty_output');
    expect(events.length).toBeLessThanOrEqual(MAX_RUNTIME_DIAGNOSTIC_EVENTS);
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ event: 'pty_output', bytes: 1000, chunks: 1000 });
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'runtime_start',
        'resume_start',
        'pty_spawn',
        'pty_output',
        'resize_requested',
        'resize_held',
        'startup_max_reached',
        'startup_stabilized',
        'resize_forwarded',
        'pty_exit',
        'runtime_stop',
      ])
    );
    expect(readTraceFile(trace.traceFile).join('')).not.toContain('output content');
  });

  it('evicts telemetry before structural events at the event bound', () => {
    jest.useFakeTimers();
    try {
      const diagnostics = RuntimeDiagnostics.start('trace_priority');
      for (let index = 0; index < MAX_RUNTIME_DIAGNOSTIC_EVENTS + 10; index += 1) {
        diagnostics.recordPtyOutput(1);
        jest.advanceTimersByTime(PTY_OUTPUT_AGGREGATION_MS);
      }
      diagnostics.recordStartupMaxReached();
      diagnostics.recordStartupStabilized('absolute_max');
      diagnostics.recordResizeForwarded(143, 41);
      diagnostics.recordPtyExit(0);
      diagnostics.recordRuntimeStop('exited');
      diagnostics.close();

      const trace = readLatestRuntimeDiagnostic('trace_priority')!;
      expect(trace.events.length).toBeLessThanOrEqual(MAX_RUNTIME_DIAGNOSTIC_EVENTS);
      expect(trace.events.map((event) => event.event)).toEqual(
        expect.arrayContaining([
          'startup_max_reached',
          'startup_stabilized',
          'resize_forwarded',
          'pty_exit',
          'runtime_stop',
        ])
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('retains only the bounded number of newest traces per session', () => {
    for (let index = 0; index < MAX_RUNTIME_DIAGNOSTIC_FILES + 1; index++) {
      const diagnostics = RuntimeDiagnostics.start('trace_retention');
      diagnostics.recordPtySpawn(143 + index, 42);
      diagnostics.close();
    }

    const files = fs
      .readdirSync(getRuntimeDiagnosticsDir('trace_retention'))
      .filter((file) => file.endsWith('.jsonl'));
    expect(files).toHaveLength(MAX_RUNTIME_DIAGNOSTIC_FILES);
    expect(readLatestRuntimeDiagnostic('trace_retention')?.events.at(-1)).toMatchObject({
      event: 'pty_spawn',
      cols: 143 + MAX_RUNTIME_DIAGNOSTIC_FILES,
    });
  });

  it('does not make filesystem failures fatal', () => {
    const blockedParent = path.join(testEnv.testDir, 'blocked');
    fs.writeFileSync(blockedParent, 'not a directory');
    process.env.AIRELAY_CONFIG = path.join(blockedParent, 'config.yaml');

    expect(() => {
      const diagnostics = RuntimeDiagnostics.start('trace_failure');
      diagnostics.recordPtyOutput(99);
      diagnostics.close();
    }).not.toThrow();

    process.env.AIRELAY_CONFIG = testEnv.configPath;
  });

  it('records authoritative PTY spawn/output/resize/exit transitions without content', async () => {
    const diagnostics = RuntimeDiagnostics.start('trace_pty');
    const pty = createPty({
      file: 'node',
      args: ['-e', "process.stdout.write('SECRET-OUTPUT'); setTimeout(() => process.exit(0), 450)"],
      detached: true,
      resizeStartupGraceMs: 100,
      resizeStartupQuietMs: 50,
      resizeStartupMaxMs: 300,
      diagnostics,
    });

    pty.requestExternalResize(143, 41);
    await wait(200);
    await pty.exitCode;
    diagnostics.recordRuntimeStop('exited');
    diagnostics.close();

    const trace = readLatestRuntimeDiagnostic('trace_pty')!;
    const names = trace.events.map((event) => event.event);
    expect(names).toEqual(
      expect.arrayContaining([
        'runtime_start',
        'resume_start',
        'pty_spawn',
        'pty_output',
        'resize_requested',
        'resize_held',
        'startup_stabilized',
        'resize_forwarded',
        'pty_exit',
        'runtime_stop',
      ])
    );
    expect(readTraceFile(trace.traceFile).join('')).not.toContain('SECRET-OUTPUT');
    expect(trace.events.find((event) => event.event === 'pty_output')).toEqual(
      expect.objectContaining({ bytes: expect.any(Number) })
    );
  });

  it('keeps lifecycle events when a harness emits 1000 tiny writes', async () => {
    const diagnostics = RuntimeDiagnostics.start('trace_high_volume_pty');
    const pty = createPty({
      file: 'node',
      args: [
        '-e',
        "let n=0; const t=setInterval(() => { process.stdout.write('x'); n += 1; if (n === 1000) { clearInterval(t); setTimeout(() => process.exit(0), 300); } }, 1)",
      ],
      detached: true,
      resizeStartupGraceMs: 100,
      resizeStartupQuietMs: 80,
      resizeStartupMaxMs: 220,
      diagnostics,
    });
    pty.requestExternalResize(143, 41);
    await pty.exitCode;
    diagnostics.recordRuntimeStop('exited');
    diagnostics.close();

    const trace = readLatestRuntimeDiagnostic('trace_high_volume_pty')!;
    const events = trace.events;
    const outputEvents = events.filter((event) => event.event === 'pty_output');
    const outputBytes = outputEvents.reduce(
      (total, event) => total + (event.event === 'pty_output' ? event.bytes : 0),
      0
    );
    expect(events.length).toBeLessThanOrEqual(MAX_RUNTIME_DIAGNOSTIC_EVENTS);
    expect(outputBytes).toBe(1000);
    expect(outputEvents.length).toBeLessThan(1000);
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'runtime_start',
        'resume_start',
        'pty_spawn',
        'pty_output',
        'resize_requested',
        'resize_held',
        'startup_max_reached',
        'startup_stabilized',
        'resize_forwarded',
        'pty_exit',
        'runtime_stop',
      ])
    );
  });

  it('distinguishes absolute startup max release from quiet release', async () => {
    const diagnostics = RuntimeDiagnostics.start('trace_max');
    const pty = createPty({
      file: 'node',
      args: [
        '-e',
        "const t=setInterval(() => process.stdout.write('x'), 25); setTimeout(() => { clearInterval(t); process.exit(0) }, 500)",
      ],
      detached: true,
      resizeStartupGraceMs: 100,
      resizeStartupQuietMs: 80,
      resizeStartupMaxMs: 220,
      diagnostics,
    });
    pty.requestExternalResize(150, 45);
    await pty.exitCode;
    diagnostics.recordRuntimeStop('exited');
    diagnostics.close();

    const events = readLatestRuntimeDiagnostic('trace_max')!.events;
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(['startup_max_reached', 'startup_stabilized', 'resize_forwarded'])
    );
    expect(events.find((event) => event.event === 'startup_stabilized')).toMatchObject({
      reason: 'absolute_max',
    });
  });

  it('retrieves the newest trace without a live controller', async () => {
    const first = RuntimeDiagnostics.start('debug_command');
    first.recordPtySpawn(100, 30);
    first.close();
    const newest = RuntimeDiagnostics.start('debug_command');
    newest.recordPtySpawn(160, 50);
    newest.close();

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(sessionDebugCommand('debug_command', { json: true })).resolves.toBe(0);
      const result = JSON.parse(String(log.mock.calls[0][0])) as {
        sessionKey: string;
        traceFile: string;
        events: Array<Record<string, unknown>>;
      };
      expect(result.sessionKey).toBe('debug_command');
      expect(result.traceFile).toContain(path.join('debug', 'debug_command'));
      expect(result.events.at(-1)).toMatchObject({ event: 'pty_spawn', cols: 160, rows: 50 });
    } finally {
      log.mockRestore();
    }
  });
});
