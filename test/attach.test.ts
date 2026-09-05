import net from 'net';
import fs from 'fs';
import { parseRequest, serializeStreamFrame } from '../src/controller/protocol';
import { IpcError, IpcErrorCodes } from '../src/types/controller';
import { SessionController } from '../src/controller';
import { AttachClient, createStreamTransport, attachCommand } from '../src/commands/attach';
import { createPty } from '../src/runtime/pty';
import { addSession, deleteSession } from '../src/commands/sessions';
import { useTestEnv } from './test-utils';

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

  it('serializes raw PTY chunks losslessly into newline-safe stream frames', () => {
    const fixture = '\x1b[31mred\x1b[0m\n\x1b[?1049h\x1b[2J\x1b[Hlines\nwrap\r\n';
    const frame = serializeStreamFrame(fixture);
    const parsed = JSON.parse(frame) as { type: string; data: { chunk: string } };
    expect(parsed.type).toBe('stream');
    expect(parsed.data.chunk).toBe(fixture);
    // Embedded newlines are escaped, so the frame itself stays on one line.
    expect(frame.split('\n').length).toBe(2);
  });
});

describe('SessionController raw stream bootstrap and broadcast over a real socket', () => {
  async function openTransport(endpoint: string) {
    const socket = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(endpoint, () => resolve());
    });
    const chunks: string[] = [];
    const transport = createStreamTransport(socket);
    transport.onStream((c) => chunks.push(c));
    return { socket, transport, chunks };
  }

  it('replays the bounded raw ring on attach and streams live chunks in order with no duplication', async () => {
    const controller = new SessionController('stream_sk1');
    controller.onRequest(() => ({ handled: true }));
    await controller.start();
    try {
      controller.feedOutput('pre-1\n');
      controller.feedOutput('\x1b[32mgreen\x1b[0m');
      controller.feedOutput('pre-3\n');

      const { socket, transport, chunks } = await openTransport(controller.endpointPath);
      const attached = await transport.requestAttach();
      expect(attached).toBe(1);
      await until(() => chunks.length >= 3);

      // Bootstrap replay contains exactly the pre-attach chunks, in order.
      expect([...chunks]).toEqual(['pre-1\n', '\x1b[32mgreen\x1b[0m', 'pre-3\n']);

      // Live chunks after attach are appended once, in order, with no
      // replayed duplicate of the boundary chunk.
      controller.feedOutput('post-1\n');
      controller.feedOutput('post-2\r\n');
      await until(() => chunks.length >= 5);
      expect([...chunks]).toEqual([
        'pre-1\n',
        '\x1b[32mgreen\x1b[0m',
        'pre-3\n',
        'post-1\n',
        'post-2\r\n',
      ]);
      socket.destroy();
    } finally {
      await controller.stop();
    }
  });

  it('feeds a chunk raced at the attach boundary exactly once on a fresh client', async () => {
    const controller = new SessionController('stream_sk2');
    controller.onRequest(() => ({ handled: true }));
    await controller.start();
    try {
      controller.feedOutput('seed\n');
      const { socket, transport, chunks } = await openTransport(controller.endpointPath);
      // Race: output fed right before the attach request is transmitted.
      controller.feedOutput('boundary\n');
      controller.feedOutput('after-send\n');
      const attached = await transport.requestAttach();
      expect(attached).toBe(1);
      controller.feedOutput('live\n');
      await until(() => chunks.length >= 4);

      // No chunk appears twice and order is preserved regardless of which side
      // of the registration boundary "boundary" landed on.
      const seen = new Set<string>();
      for (const c of chunks) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
      expect(chunks[0]).toBe('seed\n');
      expect(chunks.includes('boundary\n')).toBe(true);
      expect(chunks.includes('after-send\n')).toBe(true);
      expect(chunks[chunks.length - 1]).toBe('live\n');
      socket.destroy();
    } finally {
      await controller.stop();
    }
  });

  it('broadcasts the same lossless stream to multiple attached clients deterministically', async () => {
    const controller = new SessionController('stream_sk3');
    controller.onRequest(() => ({ handled: true }));
    await controller.start();
    try {
      controller.feedOutput('base\n');
      const a = await openTransport(controller.endpointPath);
      const b = await openTransport(controller.endpointPath);
      const [ca, cb] = await Promise.all([
        a.transport.requestAttach(),
        b.transport.requestAttach(),
      ]);
      expect(ca).toBe(1);
      expect(cb).toBe(2);

      controller.feedOutput('shared-1\n\x1b[33myellow\x1b[0m');
      controller.feedOutput('shared-2\n');
      await until(() => a.chunks.length >= 2 && b.chunks.length >= 2);

      // Bootstrap plus live must be identical across clients.
      expect(a.chunks.join('')).toBe('base\nshared-1\n\x1b[33myellow\x1b[0mshared-2\n');
      expect(b.chunks.join('')).toBe(a.chunks.join(''));
      a.socket.destroy();
      b.socket.destroy();
      await waitForAttached(controller.endpointPath, 0);
      expect(controller.getAttachedClientCount()).toBe(0);
    } finally {
      await controller.stop();
    }
  });

  it('stop() force-closes a still-attached socket and resolves promptly (bounded shutdown)', async () => {
    const controller = new SessionController('stop_sk1');
    controller.onRequest(() => ({ handled: true }));
    await controller.start();
    const { socket, transport } = await openTransport(controller.endpointPath);
    const attached = await transport.requestAttach();
    expect(attached).toBe(1);

    const start = Date.now();
    await controller.stop();
    expect(Date.now() - start).toBeLessThan(5000);
    expect(controller.getAttachedClientCount()).toBe(0);
    await until(() => socket.destroyed);
  });

  it('makes repeated stop calls share one cleanup promise', async () => {
    const controller = new SessionController('stop_idempotent');
    await controller.start();
    controller.feedOutput('buffered output\n');

    const firstStop = controller.stop();
    const secondStop = controller.stop();
    expect(secondStop).toBe(firstStop);
    await Promise.all([firstStop, secondStop]);
    expect(fs.existsSync(controller.endpointPath)).toBe(false);

    await controller.stop();
  });
});

describe('AttachClient stream behavior', () => {
  class FakeTransport {
    raw: string[] = [];
    resizes: Array<[number, number]> = [];
    stream: ((chunk: string) => void) | null = null;
    closeCb: (() => void) | null = null;
    rendered: string[] = [];
    requestedAttach = 0;
    async requestAttach(): Promise<number> {
      this.requestedAttach += 1;
      return 1;
    }
    sendRawInput(data: string): void {
      this.raw.push(data);
    }
    sendResize(cols: number, rows: number): void {
      this.resizes.push([cols, rows]);
    }
    onStream(cb: (chunk: string) => void): void {
      this.stream = cb;
    }
    onClose(cb: () => void): void {
      this.closeCb = cb;
    }
    close(): void {}
  }

  const idleStdin = { onData: () => {} };
  const idleResize = { onResize: () => {} };

  function makeClient(transport: FakeTransport) {
    return {
      client: new AttachClient({
        transport,
        stdin: idleStdin,
        resize: idleResize,
        cols: 80,
        rows: 24,
        render: (chunk: string): boolean => {
          transport.rendered.push(chunk);
          return true;
        },
        onDetach: () => {},
      }),
      transport,
    };
  }

  it('raw input is forwarded immediately with exact bytes (no Enter), independent of any output', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();
    await client.writeRaw(Buffer.from('abc'));
    expect(t.raw).toEqual(['abc']);
    expect(t.rendered.length).toBe(0);
  });

  it('drops unambiguous C0 shortcuts but keeps sequential printable input', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();

    await client.writeRaw(Buffer.from([0x01, 0x1a, 0x1c, 0x7f]));
    expect(t.raw).toEqual(['\x7f']);

    await client.writeRaw(Buffer.from('A'));
    await client.writeRaw(Buffer.from('B'));
    expect(t.raw).toEqual(['\x7f', 'A', 'B']);
  });

  it('preserves normal editing/submission bytes and plain navigation sequences', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();

    await client.writeRaw(Buffer.from([0x0d, 0x0a, 0x09, 0x08, 0x7f]));
    await client.writeRaw(Buffer.from('\x1b[A\x1b[3~\x1bOP'));
    expect(t.raw).toEqual(['\r\n\t\x08\x7f', '\x1b[A\x1b[3~\x1bOP']);
  });

  it('drops modified and Alt/Meta escape sequences without leaking partial bytes', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();

    await client.writeRaw(Buffer.from('\x1b[1;5D\x1b[1;3C\x1bX'));
    expect(t.raw).toEqual([]);
  });

  it('handles split and incomplete escape sequences with a bounded buffer', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();

    await client.writeRaw(Buffer.from('\x1b['));
    expect(t.raw).toEqual([]);
    await client.writeRaw(Buffer.from('A'));
    expect(t.raw).toEqual(['\x1b[A']);

    await client.writeRaw(Buffer.from('\x1b['));
    await client.writeRaw(Buffer.from('123456789012345678901234567890')); // over-limit CSI is dropped
    expect(t.raw).toEqual(['\x1b[A']);
    await client.writeRaw(Buffer.from('ok'));
    expect(t.raw).toEqual(['\x1b[A', 'ok']);
  });

  it('stream chunks are rendered verbatim and in order, without clear/redraw injection', async () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.start();
    const fixture = ['\x1b[31mRED\x1b[0m\n', '\x1b[?1049h', '\x1b[Hhello', '\x1b[?1049l'];
    for (const chunk of fixture) t.stream!(chunk);
    expect(t.rendered).toEqual(fixture);
    expect(t.rendered.join('').includes('\x1b[2J')).toBe(false);
  });

  it('a render failure detaches with terminal-gone', () => {
    const t = new FakeTransport();
    let reason = '';
    const client = new AttachClient({
      transport: t,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => false,
      onDetach: (r) => {
        reason = r;
      },
    });
    client.start();
    t.stream!('boom');
    expect(reason).toBe('terminal-gone');
    expect(client.isDetached()).toBe(true);
  });

  it('resize is forwarded immediately via dedicated IPC', () => {
    const t = new FakeTransport();
    const { client } = makeClient(t);
    client.writeResize(132, 43);
    expect(t.resizes).toEqual([[132, 43]]);
  });

  it('Ctrl-D detaches without sending input or stopping anything', async () => {
    const t = new FakeTransport();
    let reason = '';
    const client = new AttachClient({
      transport: t,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => true,
      onDetach: (r) => {
        reason = r;
      },
    });
    client.start();
    await client.writeRaw(Buffer.from([0x04]));
    expect(reason).toBe('ctrl-d');
    expect(t.raw.length).toBe(0);
    expect(client.isDetached()).toBe(true);
  });

  it('Ctrl-C detaches without sending raw input or stopping the runtime', async () => {
    const t = new FakeTransport();
    let reason = '';
    const client = new AttachClient({
      transport: t,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => true,
      onDetach: (r) => {
        reason = r;
      },
    });
    client.start();
    await client.writeRaw(Buffer.from([0x03]));
    expect(t.raw).toEqual([]);
    expect(reason).toBe('ctrl-c');
    expect(client.isDetached()).toBe(true);
    await client.writeRaw(Buffer.from('ls'));
    expect(t.raw).toEqual([]);
  });

  it('a socket close detaches with controller-gone', () => {
    const t = new FakeTransport();
    let reason = '';
    const client = new AttachClient({
      transport: t,
      stdin: idleStdin,
      resize: idleResize,
      cols: 80,
      rows: 24,
      render: () => true,
      onDetach: (r) => {
        reason = r;
      },
    });
    client.start();
    t.closeCb!();
    expect(reason).toBe('controller-gone');
    expect(client.isDetached()).toBe(true);
  });
});

describe('createStreamTransport framing', () => {
  it('buffers stream frames until a reader attaches, then replays them in order', async () => {
    const server = net.createServer((socket) => {
      socket.write(serializeStreamFrame('early-1\n'));
      socket.write(serializeStreamFrame('early-2\x1b[0m'));
    });
    const endpoint = `/tmp/airelay-t${process.pid}-${Date.now()}.sock`;
    await new Promise<void>((resolve) => server.listen(endpoint, () => resolve()));
    const socket = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(endpoint, () => resolve());
    });
    // Frames may arrive before onStream is registered; they must be retained.
    const received: string[] = [];
    await new Promise((r) => setTimeout(r, 150));
    const transport = createStreamTransport(socket);
    transport.onStream((c) => received.push(c));
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual(['early-1\n', 'early-2\x1b[0m']);
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects pending handshake and fires onClose when the socket closes', async () => {
    const server = net.createServer((socket) => {
      socket.destroy();
    });
    const endpoint = `/tmp/airelay-t${process.pid}-${Date.now()}-b.sock`;
    await new Promise<void>((resolve) => server.listen(endpoint, () => resolve()));
    const socket = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(endpoint, () => resolve());
    });
    let closed = 0;
    const transport = createStreamTransport(socket);
    transport.onClose(() => {
      closed += 1;
    });
    await expect(transport.requestAttach()).rejects.toThrow('socket closed');
    expect(closed).toBe(1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('attachCommand structured compatibility error', () => {
  const testEnv = useTestEnv();

  it('returns 1 with a clear structured message when the controller lacks session.attach', async () => {
    // Fake controller that answers preflight but rejects session.attach with
    // METHOD_NOT_FOUND (older protocol parity).
    const server = net.createServer((socket) => {
      let buffer = '';
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim() === '') continue;
          const req = JSON.parse(line) as { id: string; method: string };
          if (req.method === 'session.info') {
            socket.write(
              JSON.stringify({
                id: req.id,
                type: 'success',
                data: { airelayVersion: '0.1.68', controllerProtocolVersion: 2 },
              }) + '\n'
            );
          } else if (req.method === 'session.attach') {
            socket.write(
              JSON.stringify({
                id: req.id,
                type: 'error',
                error: {
                  code: IpcErrorCodes.METHOD_NOT_FOUND,
                  message: 'Unknown method "session.attach"',
                },
              }) + '\n'
            );
          }
        }
      };
      socket.on('data', onData);
    });
    const endpoint = `/tmp/airelay-t${process.pid}-${Date.now()}-compat.sock`;
    await new Promise<void>((resolve) => server.listen(endpoint, () => resolve()));

    addSession('compatpro', 'compat-id', testEnv.testDir, 'compat_key', endpoint);
    const errors: string[] = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.join(' '));
    });
    const code = await attachCommand('compat_key', {
      stdinSource: { onData: () => {} },
      resizeSource: { onResize: () => {} },
      renderOverride: () => true,
    });
    errSpy.mockRestore();
    deleteSession('compatpro', 'compat-id');
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes('Unknown method "session.attach"'))).toBe(true);
    expect(errors.some((e) => e.includes('Controller closed'))).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

async function until(cond: () => boolean, timeoutMs = 4000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('condition not met within timeout');
}
