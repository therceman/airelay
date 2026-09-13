import fs from 'fs';
import path from 'path';
import { createPty } from '../src/runtime/pty';
import {
  getRuntimeDiagnosticsDir,
  MAX_RUNTIME_DIAGNOSTIC_EVENTS,
  MAX_RUNTIME_DIAGNOSTIC_FILES,
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
    expect(trace!.events).toHaveLength(MAX_RUNTIME_DIAGNOSTIC_EVENTS);
    expect(trace!.events[0].event).toBe('runtime_start');
    expect(trace!.events[1].event).toBe('resume_start');
    expect(trace!.events.at(-1)).toMatchObject({ event: 'pty_output', bytes: 254 });
    expect(readTraceFile(trace!.traceFile).join('')).not.toContain('trace_order');
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
