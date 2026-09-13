import { SessionController } from '../src/controller';
import {
  createControllerReveal,
  RESUME_PRESENTATION_MAX_MS,
  RESUME_PRESENTATION_QUIET_MS,
  ResumePresentationGate,
  serializeResumeViewport,
} from '../src/runtime/resume-presentation';
import { RuntimeDiagnostics, readLatestRuntimeDiagnostic } from '../src/runtime/diagnostics';
import { createPty } from '../src/runtime/pty';
import { useTestEnv } from './test-utils';

useTestEnv();

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('resume foreground presentation gate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resets the full quiet timer for every output chunk', async () => {
    jest.useFakeTimers();
    const foreground: string[] = [];
    const reveals: string[] = [];
    const gate = new ResumePresentationGate({
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: async (reason) => {
        reveals.push(reason);
        return 30;
      },
    });

    gate.write('chunk-0');
    jest.advanceTimersByTime(500);
    gate.write('chunk-500');
    jest.advanceTimersByTime(700);
    gate.write('chunk-1200');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS - 1);
    await flushMicrotasks();
    expect(foreground).toEqual([]);
    expect(reveals).toEqual([]);

    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(reveals).toEqual(['quiet_period']);
    expect(foreground).toEqual([]);
    expect(gate.isOpen()).toBe(true);
  });

  it('keeps PTY ingestion independent from the caller-owned foreground writer', async () => {
    const foreground: string[] = [];
    const ingested: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', "process.stdout.write('resume-output'); process.exit(0)"],
      onOutput: (chunk) => ingested.push(chunk),
      onForegroundOutput: (chunk) => foreground.push(chunk),
    });

    await pty.exitCode;
    expect(ingested.join('')).toContain('resume-output');
    expect(foreground.join('')).toContain('resume-output');
  });

  it('never replays suppressed chunks and passes through immediately after reveal', async () => {
    jest.useFakeTimers();
    const foreground: string[] = [];
    const gate = new ResumePresentationGate({
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: async () => {
        foreground.push('FINAL-VIEWPORT');
        return 30;
      },
    });

    gate.write('raw-resume-1');
    gate.write('raw-resume-2');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS);
    await flushMicrotasks();

    gate.write('live-after-reveal');
    expect(foreground).toEqual(['FINAL-VIEWPORT', 'live-after-reveal']);
    expect(foreground).not.toContain('raw-resume-1');
    expect(foreground).not.toContain('raw-resume-2');
  });

  it('cancels a stale async quiet reveal when a new chunk arrives', async () => {
    jest.useFakeTimers();
    const foreground: string[] = [];
    let releaseFirstReveal!: () => void;
    let revealCount = 0;
    const gate = new ResumePresentationGate({
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: async (reason, isCurrent) => {
        revealCount += 1;
        if (revealCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstReveal = resolve;
          });
        }
        if (reason === 'quiet_period' && !isCurrent()) return null;
        foreground.push('FINAL-VIEWPORT');
        return 30;
      },
    });

    gate.write('before-race');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS);
    await flushMicrotasks();
    gate.write('during-reveal');
    releaseFirstReveal();
    await flushMicrotasks();

    expect(foreground).toEqual([]);
    expect(gate.isOpen()).toBe(false);
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS - 1);
    await flushMicrotasks();
    expect(foreground).toEqual([]);
    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(foreground).toEqual(['FINAL-VIEWPORT']);
    expect(revealCount).toBe(2);
  });

  it('uses the absolute max and then opens normal passthrough', async () => {
    jest.useFakeTimers();
    const foreground: string[] = [];
    const reasons: string[] = [];
    const gate = new ResumePresentationGate({
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: async (reason) => {
        reasons.push(reason);
        foreground.push('FINAL-VIEWPORT');
        return 30;
      },
    });

    for (let elapsed = 0; elapsed < RESUME_PRESENTATION_MAX_MS; elapsed += 500) {
      gate.write('continuous-output');
      jest.advanceTimersByTime(500);
    }
    await flushMicrotasks();
    expect(reasons).toEqual(['absolute_max']);
    expect(gate.isOpen()).toBe(true);
    gate.write('live');
    expect(foreground.at(-1)).toBe('live');
  });

  it('feeds every suppressed chunk to the current controller viewport', async () => {
    const controller = new SessionController('resume_gate_viewport');
    controller.resize(40, 3);
    const foreground: string[] = [];
    let outputQueue: Promise<void> = Promise.resolve();
    const writeForeground = (chunk: string): void => {
      foreground.push(chunk);
    };
    const gate = new ResumePresentationGate({
      writeForeground,
      reveal: createControllerReveal(controller, () => outputQueue, writeForeground),
    });

    for (const chunk of ['old-history\r\n', 'current-one\r\n', 'current-two\r\n']) {
      gate.write(chunk);
      outputQueue = outputQueue.then(async () => {
        controller.feedOutput(chunk);
        await controller.flushViewport();
      });
    }
    await new Promise((resolve) => setTimeout(resolve, RESUME_PRESENTATION_QUIET_MS + 100));

    expect(foreground).toHaveLength(1);
    expect(foreground[0]).toContain('current-two');
    expect(gate.isOpen()).toBe(true);
  });

  it('serializes only the visible rows and restores a clamped cursor without scrolling', () => {
    const rendered = serializeResumeViewport(
      {
        lines: ['visible-1', 'visible-2', 'visible-3', 'historical-4'],
        cursorRow: 99,
        cursorColumn: 99,
      },
      { cols: 12, rows: 3 }
    );

    expect(rendered).toContain('visible-1\r\nvisible-2\r\nvisible-3');
    expect(rendered).not.toContain('historical-4');
    expect(rendered).toContain('\x1b[3;12H');
    expect(rendered.endsWith('\n')).toBe(false);
  });

  it('disposes one generation and starts the next generation closed', async () => {
    jest.useFakeTimers();
    const firstForeground: string[] = [];
    const first = new ResumePresentationGate({
      writeForeground: (chunk) => firstForeground.push(chunk),
      reveal: async () => 30,
    });
    first.write('first-generation');
    first.dispose();
    jest.advanceTimersByTime(RESUME_PRESENTATION_MAX_MS);
    await flushMicrotasks();
    expect(firstForeground).toEqual([]);

    const secondForeground: string[] = [];
    const second = new ResumePresentationGate({
      writeForeground: (chunk) => secondForeground.push(chunk),
      reveal: async () => {
        secondForeground.push('SECOND-VIEWPORT');
        return 30;
      },
    });
    second.write('second-generation');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS);
    await flushMicrotasks();
    expect(secondForeground).toEqual(['SECOND-VIEWPORT']);
  });

  it('records bounded structural gate diagnostics without output contents', async () => {
    jest.useFakeTimers();
    const diagnostics = RuntimeDiagnostics.start('resume_gate_diagnostics');
    const gate = new ResumePresentationGate({
      writeForeground: () => undefined,
      reveal: async () => 30,
      onStarted: () => diagnostics.recordPresentationGateStarted(),
      onRevealed: (info) =>
        diagnostics.recordPresentationGateRevealed(
          info.reason,
          info.suppressedBytes,
          info.suppressedChunks,
          info.rows
        ),
    });
    gate.write('SECRET-RESUME-CONTENT');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS);
    await flushMicrotasks();
    diagnostics.close();

    const trace = readLatestRuntimeDiagnostic('resume_gate_diagnostics')!;
    expect(trace.events.map((event) => event.event)).toEqual(
      expect.arrayContaining(['presentation_gate_started', 'presentation_gate_revealed'])
    );
    expect(
      trace.events.find((event) => event.event === 'presentation_gate_revealed')
    ).toMatchObject({
      reason: 'quiet_period',
      suppressedChunks: 1,
      rows: 30,
    });
    expect(JSON.stringify(trace.events)).not.toContain('SECRET-RESUME-CONTENT');
  });
});
