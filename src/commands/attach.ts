import net from 'net';
import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { preflightVersionCheck } from './session-ipc';
import { readLines } from '../controller/protocol';

const VIEWPORT_POLL_MS = 200;
const CTRL_D = 0x04;
const CONNECT_TIMEOUT_MS = 5000;

export interface AttachTransport {
  requestViewport(): Promise<string[]>;
  sendRawInput(data: string): void;
  sendResize(cols: number, rows: number): void;
}

export interface AttachClientHooks {
  pollIntervalMs?: number;
  transport: AttachTransport;
  stdin: { onData: (cb: (chunk: Buffer) => void) => void };
  resize: { onResize: (cb: (cols: number, rows: number) => void) => void };
  cols: number;
  rows: number;
  render: (lines: string[]) => boolean;
  onDetach: (reason: string) => void;
}

export type AttachDetachReason = 'ctrl-d' | 'eof' | 'terminal-gone' | 'controller-gone' | 'manual';

/**
 * Core attach client. Viewport updates are polled on a bounded 200ms interval
 * (max 5 updates/sec), but raw input and resize are forwarded immediately via
 * dedicated narrow IPC operations (transport.sendRawInput / sendResize),
 * independent of the polling loop and with no Enter appended.
 */
export class AttachClient {
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private detached = false;
  private disconnected = false;

  constructor(private readonly hooks: AttachClientHooks) {
    this.pollIntervalMs = hooks.pollIntervalMs ?? VIEWPORT_POLL_MS;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
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

  private async tick(): Promise<void> {
    if (this.detached || this.inFlight) return;
    this.inFlight = true;
    try {
      const lines = await this.hooks.transport.requestViewport();
      if (this.detached) return;
      const ok = this.hooks.render(lines);
      if (!ok) this.detach('terminal-gone');
    } catch {
      if (!this.detached) this.detach('controller-gone');
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Forward raw terminal input immediately via the dedicated narrow IPC
   * operation. Fires without waiting for the next viewport poll and never
   * appends an Enter. Ctrl-D (0x04) detaches without stopping the runtime.
   */
  async writeRaw(chunk: Buffer): Promise<void> {
    if (this.detached || this.disconnected) return;
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
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.hooks.onDetach(reason);
  }
}

/**
 * Build a transport over a connected controller socket. Viewport requests
 * are correlated by id; raw input/resize are fire-and-forget (the controller
 * writes no reply for them), so they are never queued behind a poll.
 */
export function createAttachTransport(socket: net.Socket): AttachTransport & {
  close(): void;
} {
  let buffer = '';
  let seq = 0;
  const pending = new Map<string, (lines: string[]) => void>();
  let closed = false;

  socket.on('data', (chunk: Buffer) => {
    buffer = readLines(buffer + chunk.toString(), (line) => {
      let msg: { id?: string; type?: string; data?: { lines?: unknown } };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (
        msg.type === 'success' &&
        typeof msg.id === 'string' &&
        pending.has(msg.id) &&
        Array.isArray(msg.data?.lines)
      ) {
        const resolver = pending.get(msg.id) as (lines: string[]) => void;
        pending.delete(msg.id);
        resolver(msg.data!.lines as string[]);
      }
    });
  });

  socket.on('error', () => {
    closed = true;
    for (const reject of pending.values()) {
      reject([]);
    }
    pending.clear();
  });

  socket.on('close', () => {
    closed = true;
    for (const reject of pending.values()) {
      reject([]);
    }
    pending.clear();
  });

  return {
    requestViewport(): Promise<string[]> {
      return new Promise((resolve) => {
        if (closed) {
          resolve([]);
          return;
        }
        seq += 1;
        const id = `attach-vp-${seq}`;
        pending.set(id, resolve);
        try {
          socket.write(JSON.stringify({ id, method: 'session.viewport' }) + '\n');
        } catch {
          pending.delete(id);
          resolve([]);
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
    close(): void {
      try {
        socket.destroy();
      } catch {
        // Ignore close errors
      }
    },
  };
}

/** Send one IPC request and resolve with the single success response. */
function sendIpcWithReply(
  socket: net.Socket,
  requestId: string,
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer = readLines(buffer + chunk.toString(), (line) => {
        let msg: { id?: string; type?: string; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.id === requestId) {
          cleanup();
          if (msg.type === 'success') {
            resolve({ ok: true, data: msg });
          } else {
            resolve({ ok: false, error: msg.error?.message });
          }
        }
      });
    };
    const cleanup = (): void => {
      socket.removeListener('data', onData);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: 'IPC handshake timed out' });
    }, CONNECT_TIMEOUT_MS);

    socket.on('data', onData);
    try {
      socket.write(JSON.stringify({ id: requestId, method, params }) + '\n');
    } catch (e) {
      cleanup();
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}

export interface AttachCommandOptions {
  pollIntervalMs?: number;
  stdinSource?: AttachClientHooks['stdin'];
  resizeSource?: AttachClientHooks['resize'];
  renderOverride?: (lines: string[]) => boolean;
  cols?: number;
  rows?: number;
}

const defaultRenderer = {
  clear(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  },
  write(lines: string[]): void {
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }
  },
};

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

/**
 * `airelay attach <session>` — attach a viewport client to an existing
 * runtime. Resolves the existing session/runtime without starting a second
 * agent or PTY. Viewport polling is capped at 200ms; raw input and resize are
 * forwarded immediately via dedicated IPC. Disconnect never stops the runtime.
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

  const handshake = await sendIpcWithReply(socket, 'attach-hello', 'session.attach', {});
  if (!handshake.ok) {
    console.error(
      `Error: ${handshake.error || 'Attach handshake failed.'} Session controller may be older than this CLI.`
    );
    socket.destroy();
    return 1;
  }

  const transport = createAttachTransport(socket);
  const pollIntervalMs = options?.pollIntervalMs ?? VIEWPORT_POLL_MS;
  const cols = options?.cols ?? (process.stdout.isTTY ? process.stdout.columns : 80);
  const rows = options?.rows ?? (process.stdout.isTTY ? process.stdout.rows : 24);
  let finalExitCode = 1;

  let stdinRestore: (() => void) | null = null;
  let resizeRestore: (() => void) | null = null;
  let finish: ((code: number) => void) | null = null;

  const client = new AttachClient({
    pollIntervalMs,
    transport,
    stdin: options?.stdinSource ?? {
      onData(cb) {
        if (!process.stdin.isTTY) return;
        process.stdin.setRawMode(true);
        const handler = (chunk: Buffer): void => cb(chunk);
        process.stdin.on('data', handler);
        process.stdin.on('end', () => {
          client.detach('eof');
        });
        stdinRestore = (): void => {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore raw-mode restore errors
          }
          process.stdin.removeListener('data', handler);
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
    render: options?.renderOverride ?? renderViewport,
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
    const onClosed = (): void => {
      if (!client.isDetached()) client.detach('controller-gone');
    };
    const onError = (): void => {
      if (!client.isDetached()) client.detach('controller-gone');
    };
    socket.on('close', onClosed);
    socket.on('error', onError);

    client.start();
  });
}

function renderViewport(lines: string[]): boolean {
  try {
    defaultRenderer.clear();
    defaultRenderer.write(lines);
    return true;
  } catch {
    return false;
  }
}
