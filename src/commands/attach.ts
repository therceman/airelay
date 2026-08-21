import net from 'net';
import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { preflightVersionCheck } from './session-ipc';
import { readLines } from '../controller/protocol';

const CTRL_D = 0x04;
const CONNECT_TIMEOUT_MS = 5000;
/** Upper bound on buffered stream frames received before the reader attaches. */
const BOOTSTRAP_BACKLOG_CAP = 8192;

export interface StreamTransport {
  /** Register the attach client; resolves with the attached-client count. */
  requestAttach(): Promise<number>;
  sendRawInput(data: string): void;
  sendResize(cols: number, rows: number): void;
  onStream(cb: (chunk: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface AttachClientHooks {
  transport: StreamTransport;
  stdin: { onData: (cb: (chunk: Buffer) => void) => void };
  resize: { onResize: (cb: (cols: number, rows: number) => void) => void };
  cols: number;
  rows: number;
  /** Write one raw PTY chunk to the local terminal; return false on failure. */
  render: (chunk: string) => boolean;
  onDetach: (reason: string) => void;
}

export type AttachDetachReason =
  | 'ctrl-c'
  | 'ctrl-d'
  | 'eof'
  | 'terminal-gone'
  | 'controller-gone'
  | 'manual';

/**
 * True lossless PTY-stream attach client. Raw terminal chunks delivered by the
 * controller (`session.stream` frames) are written straight to the local
 * terminal — no viewport polling, no clear/redraw, no line reduction — so
 * ANSI/control bytes, cursor state, alternate screens, colors, wrapping, and
 * blank rows are preserved exactly. Raw input and resize still ride the narrow
 * dedicated IPC path immediately and never append Enter.
 */
export class AttachClient {
  private detached = false;
  private disconnected = false;

  constructor(private readonly hooks: AttachClientHooks) {}

  start(): void {
    this.hooks.transport.onStream((chunk) => {
      if (this.detached) return;
      const ok = this.hooks.render(chunk);
      if (!ok) this.detach('terminal-gone');
    });
    this.hooks.transport.onClose(() => {
      if (this.detached || this.disconnected) return;
      this.notifyDisconnected();
      this.detach('controller-gone');
    });
    this.hooks.resize.onResize((cols, rows) => this.writeResize(cols, rows));
    this.hooks.stdin.onData((chunk) => {
      void this.writeRaw(chunk);
    });
    // Synchronize the runtime PTY to the client terminal size immediately.
    if (this.hooks.cols > 0 && this.hooks.rows > 0) {
      this.writeResize(this.hooks.cols, this.hooks.rows);
    }
  }

  isDetached(): boolean {
    return this.detached;
  }

  /**
   * Forward raw terminal input immediately via the dedicated narrow IPC
   * operation. Never waits for output and never appends an Enter.
   *
   * Detach boundary (explicit): Ctrl-C, Ctrl-D, EOF, and terminal close detach
   * the client WITHOUT stopping the runtime. Active-turn interruption remains
   * available through the separate `airelay interrupt` command; attach must
   * not forward Ctrl-C into the harness because some harnesses exit on 0x03.
   */
  async writeRaw(chunk: Buffer): Promise<void> {
    if (this.detached || this.disconnected) return;
    if (chunk.includes(0x03)) {
      this.detach('ctrl-c');
      return;
    }
    if (chunk.includes(CTRL_D)) {
      this.detach('ctrl-d');
      return;
    }
    this.hooks.transport.sendRawInput(chunk.toString());
  }

  writeResize(cols: number, rows: number): void {
    if (this.detached || this.disconnected) return;
    if (cols > 0 && rows > 0) {
      this.hooks.transport.sendResize(cols, rows);
    }
  }

  /** Called by the transport when the underlying socket closes. */
  notifyDisconnected(): void {
    this.disconnected = true;
  }

  detach(reason: string): void {
    if (this.detached) return;
    this.detached = true;
    this.disconnected = true;
    this.hooks.onDetach(reason);
  }
}

/**
 * Build a stream transport over a connected controller socket.
 *
 * Incoming frames are routed by `type`: `stream` frames carry raw PTY chunks
 * and are forwarded to the stream reader in arrival order; `success`/`error`
 * frames resolve/reject the pending request with the matching id (the attach
 * handshake). The stream reader is registered synchronously before the attach
 * request is sent, so no frame is dropped at the bootstrap boundary; a small
 * ordered backlog covers any frames that arrive between connect and reader
 * registration, capped so it cannot grow without bound.
 */
export function createStreamTransport(socket: net.Socket): StreamTransport {
  let buffer = '';
  let seq = 0;
  let closed = false;
  const pending = new Map<
    string,
    (msg: { type?: string; data?: unknown; error?: { message?: string } }) => void
  >();
  const streamCbs: ((chunk: string) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  let streamBacklog: string[] = [];

  const deliverStream = (chunk: string): void => {
    if (streamCbs.length === 0) {
      streamBacklog.push(chunk);
      if (streamBacklog.length > BOOTSTRAP_BACKLOG_CAP) {
        streamBacklog.splice(0, streamBacklog.length - BOOTSTRAP_BACKLOG_CAP);
      }
      return;
    }
    for (const cb of streamCbs) cb(chunk);
  };

  const fireClose = (): void => {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) {
      p({ type: 'error', error: { message: 'socket closed' } });
    }
    pending.clear();
    streamBacklog = [];
    for (const cb of closeCbs) cb();
  };

  const handleLine = (line: string): void => {
    let msg: {
      type?: string;
      id?: string;
      data?: { chunk?: unknown };
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'stream' && typeof msg.data?.chunk === 'string') {
      deliverStream(msg.data.chunk);
      return;
    }
    if (
      (msg.type === 'success' || msg.type === 'error') &&
      typeof msg.id === 'string' &&
      pending.has(msg.id)
    ) {
      const resolver = pending.get(msg.id) as (msg: {
        type?: string;
        data?: unknown;
        error?: { message?: string };
      }) => void;
      pending.delete(msg.id);
      resolver(msg);
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = readLines(buffer + chunk.toString(), handleLine);
  });
  socket.on('error', fireClose);
  socket.on('close', fireClose);

  return {
    requestAttach(): Promise<number> {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error('socket closed'));
          return;
        }
        seq += 1;
        const id = `attach-${seq}`;
        pending.set(id, (msg) => {
          if (msg.type === 'success') {
            const data = (msg.data ?? {}) as { attached?: unknown };
            resolve(typeof data.attached === 'number' ? data.attached : 0);
          } else {
            reject(new Error(msg.error?.message || 'Attach request rejected by controller'));
          }
        });
        try {
          socket.write(JSON.stringify({ id, method: 'session.attach' }) + '\n');
        } catch (e) {
          pending.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    sendRawInput(data: string): void {
      try {
        socket.write(
          JSON.stringify({
            id: `attach-raw-${seq}`,
            method: 'session.input.raw',
            params: { data },
          }) + '\n'
        );
      } catch {
        closed = true;
      }
    },
    sendResize(cols: number, rows: number): void {
      try {
        socket.write(
          JSON.stringify({
            id: `attach-resize-${seq}`,
            method: 'session.resize',
            params: { cols, rows },
          }) + '\n'
        );
      } catch {
        closed = true;
      }
    },
    onStream(cb: (chunk: string) => void): void {
      streamCbs.push(cb);
      if (streamBacklog.length > 0) {
        const backlog = streamBacklog;
        streamBacklog = [];
        for (const chunk of backlog) cb(chunk);
      }
    },
    onClose(cb: () => void): void {
      closeCbs.push(cb);
      if (closed) cb();
    },
    close(): void {
      try {
        socket.destroy();
      } catch {
        // Ignore close errors
      }
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

function connectToEndpoint(endpoint: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('IPC connection timed out'));
    }, CONNECT_TIMEOUT_MS);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.connect(endpoint);
  });
}

export interface AttachCommandOptions {
  stdinSource?: AttachClientHooks['stdin'];
  resizeSource?: AttachClientHooks['resize'];
  renderOverride?: (chunk: string) => boolean;
  cols?: number;
  rows?: number;
}

function writeChunk(chunk: string): boolean {
  try {
    process.stdout.write(chunk);
    return true;
  } catch {
    return false;
  }
}

/**
 * `airelay attach <session>` — attach a true lossless PTY-stream client to an
 * existing detached runtime. Resolves the existing runtime/controller without
 * starting a second agent or PTY. Raw terminal chunks are forwarded verbatim;
 * raw input and resize use the immediate narrow IPC path. Disconnect (Ctrl-D,
 * EOF, terminal close) detaches only the client and never stops the runtime.
 */
export async function attachCommand(
  sessionKeyOrId: string,
  options?: AttachCommandOptions
): Promise<number> {
  await pruneStaleSessions();

  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    console.error(
      'Use "airelay sessions" to list sessions and "airelay detached" to list detached runtimes.'
    );
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);

  const parity = await preflightVersionCheck(endpointPath);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  for (const w of parity.warnings) {
    console.warn(`Warning: ${w}`);
  }

  let socket: net.Socket;
  try {
    socket = await connectToEndpoint(endpointPath);
  } catch (err) {
    console.error(`Error: Controller offline for session: ${sessionKeyOrId}`);
    console.error('Make sure the session is active and running.');
    return 1;
  }

  const transport = createStreamTransport(socket);
  const cols = options?.cols ?? (process.stdout.isTTY ? process.stdout.columns : 80);
  const rows = options?.rows ?? (process.stdout.isTTY ? process.stdout.rows : 24);
  let finalExitCode = 1;

  let stdinRestore: (() => void) | null = null;
  let resizeRestore: (() => void) | null = null;
  let finish: ((code: number) => void) | null = null;

  const client = new AttachClient({
    transport,
    stdin: options?.stdinSource ?? {
      onData(cb) {
        if (!process.stdin.isTTY) return;
        process.stdin.setRawMode(true);
        const handler = (chunk: Buffer): void => cb(chunk);
        const onEnd = (): void => {
          client.detach('eof');
        };
        process.stdin.on('data', handler);
        process.stdin.on('end', onEnd);
        stdinRestore = (): void => {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore raw-mode restore errors
          }
          process.stdin.removeListener('data', handler);
          process.stdin.removeListener('end', onEnd);
        };
      },
    },
    resize: options?.resizeSource ?? {
      onResize(cb) {
        if (!process.stdout.isTTY) return;
        const handler = (): void => cb(process.stdout.columns, process.stdout.rows);
        process.stdout.on('resize', handler);
        resizeRestore = () => {
          process.stdout.removeListener('resize', handler);
        };
      },
    },
    cols,
    rows,
    render: options?.renderOverride ?? writeChunk,
    onDetach(reason) {
      stdinRestore?.();
      resizeRestore?.();
      transport.close();
      if (reason === 'controller-gone') {
        console.error('Error: Controller closed; the session runtime may have exited.');
        finalExitCode = 1;
      } else {
        if (reason === 'ctrl-d' || reason === 'eof' || reason === 'manual') {
          console.log('\nDetached. Runtime continues running in background.');
        }
        finalExitCode = 0;
      }
      finish?.(finalExitCode);
    },
  });

  return new Promise<number>((resolve) => {
    finish = resolve;
    client.start();
    void withTimeout(
      transport.requestAttach(),
      CONNECT_TIMEOUT_MS,
      'Attach handshake timed out'
    ).then(
      () => {
        // Attached. Rendering and input are fully event-driven from here.
      },
      (err: Error) => {
        if (!client.isDetached()) {
          client.notifyDisconnected();
          console.error(`Error: ${err.message} Session controller may be older than this CLI.`);
          transport.close();
          resolve(1);
        }
      }
    );
  });
}
