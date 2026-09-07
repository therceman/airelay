import { EventEmitter } from 'events';
import { spawnAndWait } from '../src/runtime/spawn';
import { createPty } from '../src/runtime/pty';

class FakeResizeSource extends EventEmitter {
  isTTY = true;
  columns = 143;
  rows = 42;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('spawnAndWait', () => {
  it('returns exit code from child process', async () => {
    const exitCode = await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
    });
    expect(exitCode).toBe(0);
  });

  it('returns non-zero exit code on failure', async () => {
    const exitCode = await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'false',
      args: process.platform === 'win32' ? ['/c', 'exit 1'] : [],
    });
    expect(exitCode).not.toBe(0);
  });

  it('cleans up PTY signal listeners after PTY exits', async () => {
    const beforeSigint = process.listeners('SIGINT').length;
    const beforeSigterm = process.listeners('SIGTERM').length;

    await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
      usePty: true,
    });

    expect(process.listeners('SIGINT').length).toBe(beforeSigint);
    expect(process.listeners('SIGTERM').length).toBe(beforeSigterm);
  });

  it('does not accumulate PTY signal listeners across repeated calls', async () => {
    const beforeSigint = process.listeners('SIGINT').length;
    const beforeSigterm = process.listeners('SIGTERM').length;

    for (let i = 0; i < 3; i++) {
      await spawnAndWait({
        executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
        args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
        usePty: true,
      });
    }

    expect(process.listeners('SIGINT').length).toBe(beforeSigint);
    expect(process.listeners('SIGTERM').length).toBe(beforeSigterm);
  });

  it('cleans up signal listeners after child exits', async () => {
    const beforeSigint = process.listeners('SIGINT').length;
    const beforeSigterm = process.listeners('SIGTERM').length;

    await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
    });

    // Listeners should be back to original count
    expect(process.listeners('SIGINT').length).toBe(beforeSigint);
    expect(process.listeners('SIGTERM').length).toBe(beforeSigterm);
  });

  it('uses inherit stdio by default (TTY-compatible)', async () => {
    const exitCode = await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
    });
    expect(exitCode).toBe(0);
  });

  it('spawns and exits with PTY mode', async () => {
    const exitCode = await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
      usePty: true,
    });
    expect(exitCode).toBe(0);
  });

  it('calls onPtyReady with write function in PTY mode', async () => {
    let ptyReady = false;
    let ptyPid = 0;
    await spawnAndWait({
      executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
      usePty: true,
      onPtyReady: (pty) => {
        ptyReady = true;
        ptyPid = pty.pid;
        expect(typeof pty.write).toBe('function');
      },
    });
    expect(ptyReady).toBe(true);
    expect(ptyPid).toBeGreaterThan(0);
  });

  it('does not accumulate listeners across repeated calls', async () => {
    const beforeSigint = process.listeners('SIGINT').length;
    const beforeSigterm = process.listeners('SIGTERM').length;

    // Run spawnAndWait multiple times
    for (let i = 0; i < 3; i++) {
      await spawnAndWait({
        executable: process.platform === 'win32' ? 'cmd.exe' : 'true',
        args: process.platform === 'win32' ? ['/c', 'exit 0'] : [],
      });
    }

    // Listener count should remain stable
    expect(process.listeners('SIGINT').length).toBe(beforeSigint);
    expect(process.listeners('SIGTERM').length).toBe(beforeSigterm);
  });
});

describe('interactive PTY handoff', () => {
  it('resumes stdin when a previous interactive prompt left it paused', async () => {
    const stdin = process.stdin;
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    stdin.pause();
    const resumeSpy = jest.spyOn(stdin, 'resume');
    const pauseSpy = jest.spyOn(stdin, 'pause');

    try {
      const pty = createPty({
        file: process.platform === 'win32' ? 'node.exe' : 'node',
        args: ['-e', 'process.exit(0)'],
      });
      await pty.exitCode;

      expect(resumeSpy).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();
    } finally {
      resumeSpy.mockRestore();
      pauseSpy.mockRestore();
      if (isTTYDescriptor) {
        Object.defineProperty(stdin, 'isTTY', isTTYDescriptor);
      } else {
        delete (stdin as unknown as { isTTY?: boolean }).isTTY;
      }
    }
  });
});

describe('foreground PTY resize stabilization', () => {
  it('starts the PTY at the current terminal size', async () => {
    const source = new FakeResizeSource();
    let output = '';
    const pty = createPty({
      file: 'node',
      args: [
        '-e',
        'process.stdout.write(JSON.stringify([process.stdout.columns, process.stdout.rows]))',
      ],
      resizeSource: source,
      onOutput: (chunk) => {
        output += chunk;
      },
    });

    await pty.exitCode;
    expect(output).toContain('[143,42]');
  });

  it('coalesces a transient resize burst and forwards only a stable final size', async () => {
    const source = new FakeResizeSource();
    const traces: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'setTimeout(() => process.exit(0), 400)'],
      resizeSource: source,
      onResizeTrace: (trace) => traces.push(`${trace.kind}:${trace.cols}x${trace.rows}`),
    });

    source.rows = 42;
    source.emit('resize');
    await wait(15);
    source.rows = 41;
    source.emit('resize');
    await wait(15);
    source.rows = 42;
    source.emit('resize');
    await wait(15);
    source.rows = 41;
    source.emit('resize');
    await wait(15);
    source.rows = 42;
    source.emit('resize');
    await wait(120);

    expect(traces.filter((trace) => trace.startsWith('forwarded:'))).toEqual([]);
    await pty.exitCode;
  });

  it('forwards one genuine stable resize', async () => {
    const source = new FakeResizeSource();
    const forwarded: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'setTimeout(() => process.exit(0), 250)'],
      resizeSource: source,
      onResizeTrace: (trace) => {
        if (trace.kind === 'forwarded') forwarded.push(`${trace.cols}x${trace.rows}`);
      },
    });

    source.columns = 160;
    source.rows = 50;
    source.emit('resize');
    await wait(120);

    expect(forwarded).toEqual(['160x50']);
    await pty.exitCode;
  });

  it('does not install parent resize handling for detached PTYs', async () => {
    const source = new FakeResizeSource();
    const traces: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'setTimeout(() => process.exit(0), 150)'],
      resizeSource: source,
      detached: true,
      onResizeTrace: (trace) => traces.push(trace.kind),
    });

    source.columns = 160;
    source.rows = 50;
    source.emit('resize');
    await wait(120);
    await pty.exitCode;

    expect(traces).toEqual(['initial']);
    expect(source.listenerCount('resize')).toBe(0);
  });

  it('clears a pending resize timer and listener when the PTY exits', async () => {
    const source = new FakeResizeSource();
    const forwarded: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'process.exit(0)'],
      resizeSource: source,
      onResizeTrace: (trace) => {
        if (trace.kind === 'forwarded') forwarded.push(`${trace.cols}x${trace.rows}`);
      },
    });

    source.columns = 160;
    source.rows = 50;
    source.emit('resize');
    await pty.exitCode;
    await wait(100);

    expect(forwarded).toEqual([]);
    expect(source.listenerCount('resize')).toBe(0);
  });
});
