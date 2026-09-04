import * as pty from 'node-pty';

export interface PtyOptions {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  onOutput?: (chunk: string) => void;
  onInput?: () => void;
  /**
   * Detached mode: the PTY is owned by a supervised runtime process that has
   * no inherited terminal. Output is only forwarded to onOutput (never to
   * the parent stdout), and no stdin/resize listeners are attached.
   */
  detached?: boolean;
}

export interface PtyInstance {
  write(data: string): void;
  pid: number;
  exitCode: Promise<number>;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
}

export function createPty(options: PtyOptions): PtyInstance {
  const cols = process.stdout.isTTY ? process.stdout.columns : 80;
  const rows = process.stdout.isTTY ? process.stdout.rows : 24;

  const term = pty.spawn(options.file, options.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as { [key: string]: string },
  });

  // Forward PTY output to parent's stdout and optional onOutput callback.
  // In detached mode, output is only fed to onOutput (the controller's ring
  // buffer / viewport); it must not leak to the launcher's stdio.
  term.onData((data: string) => {
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
  if (!options.detached && process.stdout.isTTY) {
    const onResize = (): void => {
      const c = process.stdout.columns;
      const r = process.stdout.rows;
      if (c && r) {
        term.resize(c, r);
      }
    };
    process.stdout.on('resize', onResize);
    cleanups.push(() => {
      try {
        process.stdout.removeListener('resize', onResize);
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
    resize: (cols: number, rows: number) => term.resize(cols, rows),
  };
}
