import { spawnAndWait } from '../src/runtime/spawn';
import { createPty } from '../src/runtime/pty';

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
