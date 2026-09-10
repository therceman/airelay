import * as pty from 'node-pty';

export interface PtyOptions {
  file: string;
  args: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  onOutput?: (chunk: string) => void;
  onInput?: () => void;
  /** Optional parent terminal source, primarily for deterministic tests. */
  resizeSource?: PtyResizeSource;
  /** Quiet period for coalescing parent terminal resize bursts. */
  resizeDebounceMs?: number;
  /**
   * Keep resize events out of the harness while its initial screen is being
   * rendered. Resume-capable TUIs may replay their history during this window.
   */
  resizeStartupGraceMs?: number;
  /** Bounded resize diagnostics; no PTY output is included. */
  onResizeTrace?: (trace: PtyResizeTrace) => void;
  /**
   * Detached mode: the PTY is owned by a supervised runtime process that has
   * no inherited terminal. Output is only forwarded to onOutput (never to
   * the parent stdout), and no stdin/resize listeners are attached.
   */
  detached?: boolean;
}

export interface PtyResizeSource {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  on(event: 'resize', listener: () => void): void;
  removeListener(event: 'resize', listener: () => void): void;
}

export interface PtyResizeTrace {
  kind: 'initial' | 'outer' | 'forwarded';
  cols: number;
  rows: number;
  timestamp: number;
}

export interface PtyInstance {
  write(data: string): void;
  pid: number;
  exitCode: Promise<number>;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
}

export function createPty(options: PtyOptions): PtyInstance {
  const resizeSource = options.resizeSource ?? process.stdout;
  const cols = options.cols ?? (resizeSource.isTTY ? (resizeSource.columns ?? 80) : 80);
  const rows = options.rows ?? (resizeSource.isTTY ? (resizeSource.rows ?? 24) : 24);

  const term = pty.spawn(options.file, options.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as { [key: string]: string },
  });
  let currentCols = cols;
  let currentRows = rows;
  let pendingResize: { cols: number; rows: number } | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const resizeStartupGraceMs = Math.max(0, options.resizeStartupGraceMs ?? 1000);
  const resizeStartupDeadline = Date.now() + resizeStartupGraceMs;
  let hasOutput = false;
  let traceCount = 0;
  const traceLimit = 128;
  const traceResize = (kind: PtyResizeTrace['kind'], nextCols: number, nextRows: number): void => {
    if (traceCount >= traceLimit) return;
    traceCount += 1;
    const trace: PtyResizeTrace = {
      kind,
      cols: nextCols,
      rows: nextRows,
      timestamp: Date.now(),
    };
    options.onResizeTrace?.(trace);
    if (process.env.AIRELAY_DEBUG_PTY_RESIZE === '1') {
      console.error(
        `[airelay:pty-resize] ${trace.kind} ${trace.cols}x${trace.rows} ${trace.timestamp}`
      );
    }
  };
  traceResize('initial', cols, rows);
  const cancelPendingResize = (): void => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    pendingResize = null;
  };
  const resizeIfChanged = (nextCols: number, nextRows: number): void => {
    if (nextCols <= 0 || nextRows <= 0) return;
    cancelPendingResize();
    if (currentCols === nextCols && currentRows === nextRows) return;
    term.resize(nextCols, nextRows);
    currentCols = nextCols;
    currentRows = nextRows;
    traceResize('forwarded', nextCols, nextRows);
  };
  const scheduleOuterResize = (nextCols: number, nextRows: number): void => {
    traceResize('outer', nextCols, nextRows);
    pendingResize = { cols: nextCols, rows: nextRows };
    if (resizeTimer) clearTimeout(resizeTimer);
    const quietPeriodMs = Math.max(0, options.resizeDebounceMs ?? 75);
    const startupDelayMs = hasOutput ? 0 : Math.max(0, resizeStartupDeadline - Date.now());
    resizeTimer = setTimeout(
      () => {
        resizeTimer = null;
        const next = pendingResize;
        pendingResize = null;
        if (!next) return;
        if (!hasOutput && Date.now() < resizeStartupDeadline) {
          pendingResize = next;
          scheduleOuterResize(next.cols, next.rows);
          return;
        }
        resizeIfChanged(next.cols, next.rows);
      },
      Math.max(quietPeriodMs, startupDelayMs)
    );
  };

  // Forward PTY output to parent's stdout and optional onOutput callback.
  // In detached mode, output is only fed to onOutput (the controller's ring
  // buffer / viewport); it must not leak to the launcher's stdio.
  term.onData((data: string) => {
    hasOutput = true;
    if (!options.detached) {
      process.stdout.write(data);
    }
    options.onOutput?.(data);
  });

  // Forward parent's stdin to PTY (raw mode for proper TTY handling).
  // Detached runtimes never inherit stdin, so attach is performed later
  // through dedicated IPC instead.
  const cleanups: (() => void)[] = [];

  if (!options.detached && process.stdin.isTTY) {
    const stdinWasFlowing = process.stdin.readableFlowing;
    process.stdin.setRawMode?.(true);
    const onStdinData = (chunk: Buffer) => {
      options.onInput?.();
      term.write(chunk.toString());
    };
    process.stdin.on('data', onStdinData);
    // Enquirer pauses stdin when its prompt closes. Adding a data listener
    // alone does not resume an explicitly paused stream, so input would be
    // silently swallowed after launching a PTY from an interactive picker.
    process.stdin.resume();
    cleanups.push(() => {
      try {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onStdinData);
        if (stdinWasFlowing === false) {
          process.stdin.pause();
        }
      } catch {
        // Ignore cleanup errors
      }
    });
  }

  // Forward terminal resize events to PTY.
  // Detached runtimes have no parent terminal to watch.
  if (!options.detached && resizeSource.isTTY) {
    const onResize = (): void => {
      const c = resizeSource.columns;
      const r = resizeSource.rows;
      if (c && r) {
        scheduleOuterResize(c, r);
      }
    };
    resizeSource.on('resize', onResize);
    cleanups.push(() => {
      try {
        resizeSource.removeListener('resize', onResize);
        cancelPendingResize();
      } catch {
        // Ignore cleanup errors
      }
    });
  }

  const runCleanups = (): void => {
    for (const fn of cleanups) {
      fn();
    }
  };

  const exitPromise = new Promise<number>((resolve) => {
    term.onExit((ev: { exitCode: number; signal?: number }) => {
      runCleanups();
      resolve(ev.exitCode);
    });
  });

  return {
    write: (data: string) => term.write(data),
    pid: term.pid,
    exitCode: exitPromise,
    kill: (signal?: string) => term.kill(signal),
    resize: resizeIfChanged,
  };
}
