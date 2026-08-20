import net from 'net';
import { parseRequest } from '../src/controller/protocol';
import { IpcError, IpcErrorCodes } from '../src/types/controller';
import { SessionController } from '../src/controller';
import { AttachClient } from '../src/commands/attach';
import { createPty } from '../src/runtime/pty';

jest.setTimeout(60000);

function expectIpcError(fn: () => void, expectedCode: string): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(IpcError);
  expect((err as IpcError).code).toBe(expectedCode);
}

describe('new IPC protocol methods', () => {
  it('accepts session.attach / session.detach / session.input.raw / session.resize', () => {
    const raw = parseRequest('{"id":"r1","method":"session.input.raw","params":{"data":"abc"}}');
    expect(raw.method).toBe('session.input.raw');
    expect(raw.params!.data).toBe('abc');

    const resize = parseRequest(
      '{"id":"r2","method":"session.resize","params":{"cols":120,"rows":40}}'
    );
    expect(resize.method).toBe('session.resize');
    expect(resize.params!.cols).toBe(120);

    expect(parseRequest('{"id":"r3","method":"session.attach"}').method).toBe('session.attach');
    expect(parseRequest('{"id":"r4","method":"session.detach"}').method).toBe('session.detach');
  });

  it('rejects session.input.raw without a string data param', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.input.raw","params":{}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.input.raw","params":{"data":42}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
  });

  it('rejects bad session.resize params', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.resize","params":{}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.resize","params":{"cols":0,"rows":40}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.resize","params":{"cols":120}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
  });
});

describe('SessionController attach/raw/resize over a real socket', () => {
  it('tracks attached clients, forwards raw input verbatim, and propagates resize', async () => {
    const controller = new SessionController('attach_sk1');
    const rawRequests: Array<string | undefined> = [];
    const resizeRequests: Array<{ cols?: number; rows?: number }> = [];

    controller.onRequest((req) => {
      if (req.method === 'session.input.raw') {
        rawRequests.push((req.params as { data?: string }).data);
        return { delivered: true };
      }
      if (req.method === 'session.resize') {
        resizeRequests.push(req.params as { cols?: number; rows?: number });
        return { resized: true };
      }
      return { handled: false };
    });

    await controller.start();
    try {
      const c1 = await connectAndAttach(controller.endpointPath);
      expect(c1.attached).toBe(1);
      const c2 = await connectAndAttach(controller.endpointPath);
      expect(c2.attached).toBe(2);

      const info = await sessionInfo(controller.endpointPath);
      expect(info.attached).toBe(2);

      await rawWrite(controller.endpointPath, 'hello raw');
      await rawWrite(controller.endpointPath, 'second');
      expect(rawRequests).toEqual(['hello raw', 'second']);

      await resizeWrite(controller.endpointPath, 100, 40);
      expect(resizeRequests).toEqual([{ cols: 100, rows: 40 }]);

      c1.socket.destroy();
      await waitForAttached(controller.endpointPath, 1);
      c2.socket.destroy();
      await waitForAttached(controller.endpointPath, 0);
    } finally {
      await controller.stop();
    }
  });
});

describe('AttachClient core behavior', () => {
  class FakeTransport {
    raw: string[] = [];
    resizes: Array<[number, number]> = [];
    viewportCalls = 0;
    lines: string[] = [];
    async requestViewport(): Promise<string[]> {
      this.viewportCalls += 1;
      return this.lines;
    }
    sendRawInput(data: string): void {
      this.raw.push(data);
    }
    sendResize(cols: number, rows: number): void {
      this.resizes.push([cols, rows]);
    }
  }

  const idleStdin = { onData: () => {} };
  const idleResize = { onResize: () => {} };

  it('raw input is forwarded immediately with exact bytes (no Enter), independent of polling', () => {
    const transport = new FakeTransport();
    const renders: string[][] = [];
    const client = new AttachClient({
      pollIntervalMs: 200,
      transport,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: (lines) => {
        renders.push(lines);
        return true;
      },
      onDetach: () => {},
    });
    // Do NOT start polling: raw must still be deliverable.
    expect(client.writeRaw(Buffer.from('abc'))).resolves.toBe(undefined);
    expect(transport.raw).toEqual(['abc']);
    expect(renders.length).toBe(0);
    expect(transport.resizes.length).toBe(0);
  });

  it('polling alone never produces input and never appends Enter', async () => {
    const transport = new FakeTransport();
    transport.lines = ['A', 'B'];
    const renders: string[][] = [];
    const client = new AttachClient({
      pollIntervalMs: 20,
      transport,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: (lines) => {
        renders.push(lines);
        return true;
      },
      onDetach: () => {},
    });
    client.start();
    await new Promise((r) => setTimeout(r, 150));
    client.detach('manual');
    expect(renderCount(renders)).toBeGreaterThanOrEqual(1);
    expect(transport.raw.length).toBe(0);
  });

  it('resize is forwarded immediately via dedicated IPC', () => {
    const transport = new FakeTransport();
    const client = new AttachClient({
      pollIntervalMs: 200,
      transport,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => true,
      onDetach: () => {},
    });
    client.writeResize(132, 43);
    expect(transport.resizes).toEqual([[132, 43]]);
  });

  it('viewport polling stays at a bounded cadence (max 5 updates/sec)', async () => {
    const transport = new FakeTransport();
    transport.lines = ['x'];
    const renders: string[][] = [];
    const client = new AttachClient({
      pollIntervalMs: 200,
      transport,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: (lines) => {
        renders.push(lines);
        return true;
      },
      onDetach: () => {},
    });
    const t0 = Date.now();
    client.start();
    await new Promise((r) => setTimeout(r, 700));
    const elapsed = Date.now() - t0;
    client.detach('manual');

    const limit = Math.ceil(elapsed / 200) + 1;
    expect(renderCount(renders)).toBeGreaterThanOrEqual(1);
    expect(renderCount(renders)).toBeLessThanOrEqual(limit);
  });

  it('Ctrl-D detaches without sending input or stopping anything', () => {
    const transport = new FakeTransport();
    let reason = '';
    const client = new AttachClient({
      pollIntervalMs: 200,
      transport,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => true,
      onDetach: (r) => {
        reason = r;
      },
    });
    void client.writeRaw(Buffer.from([0x04]));
    expect(reason).toBe('ctrl-d');
    expect(transport.raw.length).toBe(0);
    expect(client.isDetached()).toBe(true);
  });
});

describe('pty direct-path regression (detached vs inherited terminal)', () => {
  it('non-detached PTY writes output to stdout immediately (no viewport polling gate)', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const received: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'process.stdout.write("HELLO")'],
      onOutput: (chunk) => received.push(chunk),
    });
    const code = await pty.exitCode;
    expect(code).toBe(0);
    const stdoutCalls = (writeSpy.mock.calls.map((c) => String(c[0])) as string[]).join('');
    expect(stdoutCalls).toContain('HELLO');
    expect(received.join('')).toContain('HELLO');
    writeSpy.mockRestore();
  });

  it('detached PTY suppresses stdout forwarding but keeps onOutput feeding', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const received: string[] = [];
    const pty = createPty({
      file: 'node',
      args: ['-e', 'process.stdout.write("BYE")'],
      onOutput: (chunk) => received.push(chunk),
      detached: true,
    });
    const code = await pty.exitCode;
    expect(code).toBe(0);
    const stdoutCalls = (writeSpy.mock.calls.map((c) => String(c[0])) as string[]).join('');
    expect(stdoutCalls).not.toContain('BYE');
    expect(received.join('')).toContain('BYE');
    writeSpy.mockRestore();
  });
});

// ---- helpers ----

function renderCount(renders: string[][]): number {
  return renders.length;
}

function rawWrite(endpoint: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.once('error', reject);
    socket.connect(endpoint, () => {
      socket.write(
        JSON.stringify({
          id: `raw-${Math.random().toString(36).slice(2)}`,
          method: 'session.input.raw',
          params: { data },
        }) + '\n'
      );
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 120);
    });
  });
}

function resizeWrite(endpoint: string, cols: number, rows: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.once('error', reject);
    socket.connect(endpoint, () => {
      socket.write(
        JSON.stringify({
          id: `rz-${Date.now()}`,
          method: 'session.resize',
          params: { cols, rows },
        }) + '\n'
      );
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 120);
    });
  });
}

function sessionInfo(endpoint: string): Promise<{ attached?: number }> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.once('error', reject);
    socket.on('data', (d: Buffer) => {
      buffer += d.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const msg = JSON.parse(buffer.slice(0, idx));
        socket.destroy();
        resolve(msg.data as { attached?: number });
      }
    });
    socket.connect(endpoint, () => {
      socket.write(JSON.stringify({ id: 'info-1', method: 'session.info' }) + '\n');
    });
  });
}

function waitForAttached(endpoint: string, expected: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const loop = (): void => {
      void sessionInfo(endpoint).then((info) => {
        if ((info.attached ?? 0) === expected || Date.now() - start > 5000) {
          resolve();
        } else {
          setTimeout(loop, 50);
        }
      });
    };
    loop();
  });
}

function connectAndAttach(endpoint: string): Promise<{ socket: net.Socket; attached: number }> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.once('error', reject);
    socket.on('data', (d: Buffer) => {
      buffer += d.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const msg = JSON.parse(buffer.slice(0, idx));
        socket.removeAllListeners('data');
        resolve({ socket, attached: (msg.data as { attached?: number }).attached ?? 0 });
      }
    });
    socket.connect(endpoint, () => {
      socket.write(JSON.stringify({ id: 'attach-hello', method: 'session.attach' }) + '\n');
    });
  });
}
