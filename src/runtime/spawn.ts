import spawn from 'cross-spawn';
import { findExecutablePath } from './resolveExecutable';
import { registerPID, unregisterPID } from '../utils/pid';
import { createPty } from './pty';

export interface SpawnOptions {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  profile?: string;
  trackPID?: boolean;
  usePty?: boolean;
  detached?: boolean;
  onPtyReady?: (pty: {
    pid: number;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
  }) => void;

  /** Called when a foreground PTY client writes input to the child. */
  onInput?: () => void;

  /**
   * Called with output data from the child process (chunks of stdout).
   * Used by SessionController to maintain a recent output buffer.
   */
  onOutput?: (chunk: string) => void;
}

function spawnChild(options: SpawnOptions) {
  const execPath = findExecutablePath(options.executable);

  const child = spawn(execPath, options.args || [], {
    cwd: options.cwd,
    env: options.env as Record<string, string> & NodeJS.ProcessEnv,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    detached: false,
  });

  if (options.trackPID && child.pid) {
    registerPID(child.pid, options.executable, options.args || [], options.profile);
  }

  return child;
}

export function spawnAndWait(options: SpawnOptions): Promise<number> {
  if (options.usePty) {
    return spawnAndWaitPty(options);
  }

  const child = spawnChild(options);

  return new Promise<number>((resolve, reject) => {
    child.on('close', (code) => {
      if (options.trackPID && child.pid) {
        unregisterPID(child.pid);
      }
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      if (options.trackPID && child.pid) {
        unregisterPID(child.pid);
      }
      reject(new Error(`Failed to spawn ${options.executable}: ${err.message}`));
    });

    const onSigint = (): void => {
      child.kill('SIGINT');
    };
    const onSigterm = (): void => {
      child.kill('SIGTERM');
    };

    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    const cleanup = (): void => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };

    child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        return;
      }
      if (code !== 0 && code !== null) {
        console.log('\n');
      }
    });

    child.on('close', cleanup);
    child.on('error', cleanup);
  });
}

async function spawnAndWaitPty(options: SpawnOptions): Promise<number> {
  const execPath = findExecutablePath(options.executable);

  const pty = createPty({
    file: execPath,
    args: options.args || [],
    cwd: options.cwd,
    env: options.env,
    onOutput: options.onOutput,
    onInput: options.onInput,
    detached: options.detached === true,
  });

  if (options.trackPID) {
    registerPID(pty.pid, options.executable, options.args || [], options.profile);
  }

  if (options.onPtyReady) {
    options.onPtyReady({
      pid: pty.pid,
      write: (data: string) => pty.write(data),
      resize: (cols: number, rows: number) => pty.resize(cols, rows),
      kill: (signal?: string) => pty.kill(signal),
    });
  }

  const onSigint = (): void => {
    if (process.platform === 'win32') {
      pty.kill();
    } else {
      pty.kill('SIGINT');
    }
  };
  const onSigterm = (): void => {
    if (process.platform === 'win32') {
      pty.kill();
    } else {
      pty.kill('SIGTERM');
    }
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    const exitCode = await pty.exitCode;
    return exitCode;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);

    if (options.trackPID) {
      unregisterPID(pty.pid);
    }
  }
}
