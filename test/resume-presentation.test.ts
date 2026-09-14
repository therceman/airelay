import { SessionController } from '../src/controller';
import {
  createControllerReveal,
  RESUME_PRESENTATION_MAX_MS,
  RESUME_PRESENTATION_QUIET_MS,
  ResumePresentationGate,
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

  it('does not start the quiet period until the first PTY output', async () => {
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

    jest.advanceTimersByTime(1500);
    await flushMicrotasks();
    expect(gate.isOpen()).toBe(false);
    expect(reveals).toEqual([]);

    gate.write('first-output');
    jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS - 1);
    await flushMicrotasks();
    expect(gate.isOpen()).toBe(false);
    expect(reveals).toEqual([]);

    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(gate.isOpen()).toBe(true);
    expect(reveals).toEqual(['quiet_period']);
    expect(foreground).toEqual([]);
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

  it('defers quiet reveal in the alternate buffer and waits for the next output', async () => {
    jest.useFakeTimers();
    const controller = new SessionController('resume_gate_alternate_readiness');
    controller.resize(40, 3);
    const foreground: string[] = [];
    const deferred: string[] = [];
    const diagnostics = RuntimeDiagnostics.start('resume_gate_alternate_readiness');
    let outputQueue: Promise<void> = Promise.resolve();
    const sendOutput = (chunk: string): void => {
      gate.write(chunk);
      outputQueue = outputQueue.then(async () => {
        controller.feedOutput(chunk);
        await controller.flushViewport();
      });
    };
    const flushOutputQueue = async (): Promise<void> => {
      await flushMicrotasks();
      jest.advanceTimersByTime(1);
      await outputQueue;
    };
    const gate = new ResumePresentationGate({
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: createControllerReveal(
        controller,
        () => outputQueue,
        (chunk) => foreground.push(chunk)
      ),
      onRevealDeferred: (info) => {
        deferred.push(info.reason);
        diagnostics.recordPresentationGateRevealDeferred(
          info.suppressedBytes,
          info.suppressedChunks
        );
      },
      onRevealed: (info) =>
        diagnostics.recordPresentationGateRevealed(
          info.reason,
          info.suppressedBytes,
          info.suppressedChunks,
          info.rows,
          info.activeBuffer
        ),
    });

    try {
      sendOutput('\x1b[?1049hTRANSITIONAL');
      await flushOutputQueue();
      jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS);
      await flushMicrotasks();
      jest.advanceTimersByTime(1);
      await flushMicrotasks();

      expect(controller.getActiveBufferType()).toBe('alternate');
      expect(gate.isOpen()).toBe(false);
      expect(foreground).toEqual([]);
      expect(deferred).toEqual(['alternate_buffer']);

      jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS * 3);
      await flushMicrotasks();
      expect(deferred).toHaveLength(1);

      sendOutput('\x1b[?1049lREADY');
      await flushOutputQueue();
      jest.advanceTimersByTime(RESUME_PRESENTATION_QUIET_MS - 1);
      await flushMicrotasks();
      expect(gate.isOpen()).toBe(false);
      jest.advanceTimersByTime(1);
      await flushMicrotasks();
      jest.advanceTimersByTime(1);
      await flushMicrotasks();

      expect(controller.getActiveBufferType()).toBe('normal');
      expect(gate.isOpen()).toBe(true);
      expect(foreground).toHaveLength(1);
      diagnostics.close();
      const trace = readLatestRuntimeDiagnostic('resume_gate_alternate_readiness')!;
      expect(trace.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'presentation_gate_reveal_deferred',
            reason: 'alternate_buffer',
            activeBuffer: 'alternate',
          }),
          expect.objectContaining({
            event: 'presentation_gate_revealed',
            reason: 'quiet_period',
            activeBuffer: 'normal',
          }),
        ])
      );
    } finally {
      gate.dispose();
      diagnostics.close();
      await controller.stop();
    }
  });

  it('records alternate active buffer on the bounded absolute-max cutover', async () => {
    jest.useFakeTimers();
    const controller = new SessionController('resume_gate_alternate_max');
    controller.resize(40, 3);
    const foreground: string[] = [];
    const revealed: Array<{ reason: string; activeBuffer: string }> = [];
    let outputQueue: Promise<void> = Promise.resolve();
    const gate = new ResumePresentationGate({
      quietMs: 10,
      maxMs: 100,
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: createControllerReveal(
        controller,
        () => outputQueue,
        (chunk) => foreground.push(chunk)
      ),
      onRevealed: (info) => revealed.push({ reason: info.reason, activeBuffer: info.activeBuffer }),
    });

    try {
      gate.write('\x1b[?1049hALTERNATE');
      outputQueue = outputQueue.then(async () => {
        controller.feedOutput('\x1b[?1049hALTERNATE');
        await controller.flushViewport();
      });
      await flushMicrotasks();
      jest.advanceTimersByTime(1);
      await outputQueue;
      jest.advanceTimersByTime(100);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await flushMicrotasks();
        jest.advanceTimersByTime(1);
      }
      await flushMicrotasks();

      expect(gate.isOpen()).toBe(true);
      expect(revealed).toEqual([{ reason: 'absolute_max', activeBuffer: 'alternate' }]);
      expect(foreground).toHaveLength(1);
    } finally {
      gate.dispose();
      await controller.stop();
    }
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

  it('writes post-cutoff chunks after the absolute-max viewport in order', async () => {
    jest.useFakeTimers();
    const foreground: string[] = [];
    let releaseReveal!: () => void;
    let revealStarted = false;
    const gate = new ResumePresentationGate({
      quietMs: 10,
      maxMs: 100,
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: async (reason) => {
        expect(reason).toBe('absolute_max');
        revealStarted = true;
        await new Promise<void>((resolve) => {
          releaseReveal = resolve;
        });
        foreground.push('FINAL-VIEWPORT');
        return 3;
      },
    });

    gate.write('pre-cutoff-1');
    gate.write('pre-cutoff-2');
    jest.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(revealStarted).toBe(true);

    gate.write('post-cutoff-1');
    gate.write('post-cutoff-2');
    releaseReveal();
    await flushMicrotasks();

    expect(foreground).toEqual(['FINAL-VIEWPORT', 'post-cutoff-1', 'post-cutoff-2']);
    expect(foreground).not.toContain('pre-cutoff-1');
    expect(foreground).not.toContain('pre-cutoff-2');
    expect(gate.isOpen()).toBe(true);

    gate.write('live-after-cutover');
    expect(foreground).toEqual([
      'FINAL-VIEWPORT',
      'post-cutoff-1',
      'post-cutoff-2',
      'live-after-cutover',
    ]);
  });

  it('materializes only through the max cutoff before flushing post-cutoff output', async () => {
    jest.useFakeTimers();
    const controller = new SessionController('resume_gate_cutoff_queue');
    controller.resize(40, 3);
    const foreground: string[] = [];
    let releaseCutoffQueue!: () => void;
    let outputGeneration = 0;
    let cutoffGeneration: number | null = null;
    let cutoffQueue: Promise<void> | null = null;
    let releasePostOutput: (() => void) | null = null;
    let postOutputRelease: Promise<void> | null = null;
    let outputQueue: Promise<void> = new Promise<void>((resolve) => {
      releaseCutoffQueue = resolve;
    });
    const queueOutput = (chunk: string): void => {
      const chunkGeneration = ++outputGeneration;
      outputQueue = outputQueue.then(async () => {
        if (cutoffGeneration !== null && chunkGeneration > cutoffGeneration) {
          await (postOutputRelease ?? Promise.resolve());
        }
        controller.feedOutput(chunk);
        await controller.flushViewport();
      });
    };
    const gate = new ResumePresentationGate({
      quietMs: RESUME_PRESENTATION_QUIET_MS,
      maxMs: RESUME_PRESENTATION_QUIET_MS,
      writeForeground: (chunk) => foreground.push(chunk),
      reveal: createControllerReveal(
        controller,
        () => cutoffQueue ?? outputQueue,
        (chunk) => foreground.push(chunk)
      ),
      onAbsoluteMaxCutoff: () => {
        cutoffQueue = outputQueue;
        cutoffGeneration = outputGeneration;
        postOutputRelease = new Promise<void>((resolve) => {
          releasePostOutput = resolve;
        });
      },
      onAbsoluteMaxRevealReady: () => {
        releasePostOutput?.();
        releasePostOutput = null;
        postOutputRelease = null;
        cutoffQueue = null;
        cutoffGeneration = null;
      },
    });

    gate.write('cutoff-output\r\n');
    queueOutput('cutoff-output\r\n');
    jest.advanceTimersByTime(RESUME_PRESENTATION_MAX_MS - 9000);
    await flushMicrotasks();
    expect(gate.isOpen()).toBe(false);

    gate.write('post-cutoff-1');
    queueOutput('post-cutoff-1');
    gate.write('post-cutoff-2');
    queueOutput('post-cutoff-2');
    releaseCutoffQueue();
    for (let i = 0; i < 6; i += 1) {
      await flushMicrotasks();
      jest.runOnlyPendingTimers();
    }

    expect(gate.isOpen()).toBe(true);
    expect(foreground).toHaveLength(3);
    expect(foreground[0]).toContain('cutoff-output');
    expect(foreground[1]).toBe('post-cutoff-1');
    expect(foreground[2]).toBe('post-cutoff-2');
    expect(foreground[0]).not.toContain('post-cutoff-1');
    expect(foreground[0]).not.toContain('post-cutoff-2');
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
