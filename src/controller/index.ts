import net from 'net';
import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';
import { Terminal } from '@xterm/headless';
import {
  IpcRequest,
  IpcResponse,
  IpcError,
  IpcErrorCodes,
  IpcErrorReasons,
} from '../types/controller';
import {
  parseRequest,
  createSuccessResponse,
  createErrorResponse,
  serializeResponse,
  readLines,
} from './protocol';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { getAirelayVersion, CONTROLLER_PROTOCOL_VERSION } from '../utils/version';
import { appendTranscriptSnapshot } from '../utils/transcript';
import { serializeStreamFrame } from './protocol';
import type { DeliveryStatus } from '../runtime/delivery';

const VIEWPORT_ROWS = 30;
const VIEWPORT_COLS = 120;
const SNAPSHOT_INTERVAL = 5000;
const TRANSCRIPT_STABILITY_DELAY = 10000;
const MAX_SNAPSHOT_LINES = 120;
/** Bounded raw-output ring used as the lossless attach bootstrap (in-memory only). */
const RAW_RING_MAX_BYTES = 256 * 1024;
const RAW_RING_MAX_CHUNKS = 8192;
/** Per-socket buffered-bytes cap; slow clients are detached deterministically. */
const STREAM_MAX_BUFFERED_BYTES = 256 * 1024;
/** Bound on server.close() during shutdown so stop() can never hang. */
const STOP_TIMEOUT_MS = 2000;

function isTranscriptStatusFooter(line: string): boolean {
  const normalized = line.trim();
  return (
    /·\s*Context\s+\d+%\s+left\s+·.*·\s*weekly\s+\d+%\s+left\s*$/.test(normalized) ||
    /^›\s/.test(normalized)
  );
}

export type IpcHandler = (request: IpcRequest) => Promise<unknown> | unknown;

export class SessionController {
  private server: net.Server | null = null;
  private socketPath: string;
  private handler: IpcHandler | null = null;
  /** Historical ring buffer (100 lines) — exposed via session.output */
  private outputBuf: string[] = [];
  private readonly MAX_OUTPUT_LINES = 100;
  /** Raw PTY output ring used as the bounded lossless attach bootstrap. */
  private rawRing: string[] = [];
  private rawRingBytes = 0;
  private readonly sessionKey: string;
  private readonly startedAt: number;
  private readonly airelayVersion: string;
  private readonly protocolVersion: number;
  /** Headless xterm terminal — maintains true visible screen state */
  private readonly terminal: Terminal;
  /** Rolling window of recently-visible viewport lines (snapshot history) */
  private snapshotWindow: string[] = [];
  private snapshotLineSet: Set<string> = new Set();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  /** Timestamp of last output change (for activity state) */
  private lastOutputChangeAt: number = Date.now();
  private lastTranscriptLines: string[] | null = null;
  private pendingTranscriptLines: string[] | null = null;
  private pendingTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptPersistenceEnabled = false;
  private deliveryStatusProvider: (() => DeliveryStatus | undefined) | null = null;
  private activityStateProvider: (() => 'busy' | 'idle') | null = null;
  /** Open sockets that are attached viewport clients (tracked for session.info / registry). */
  private attachedClients: Set<net.Socket> = new Set();
  private onAttachedChangeCb: ((count: number) => void) | null = null;

  /**
   * Register a callback fired whenever the number of attached viewport
   * clients changes. Used by the detached runtime to keep the registry's
   * attached-client count in sync.
   */
  setOnAttachedChange(cb: (count: number) => void): void {
    this.onAttachedChangeCb = cb;
  }

  /** Number of currently attached viewport clients. */
  getAttachedClientCount(): number {
    return this.attachedClients.size;
  }

  /** Test accessor for lastOutputChangeAt. */
  lastOutputChangeAtForTest(): number {
    return this.lastOutputChangeAt;
  }

  /** Test accessor: current headless terminal viewport coordinates. */
  viewportPositionForTest(): { viewportY: number; baseY: number } {
    const buffer = this.terminal.buffer.active;
    return { viewportY: buffer.viewportY, baseY: buffer.baseY };
  }

  /** Test accessor: scroll the headless terminal viewport (simulates a scrolled-up live view). */
  scrollViewportForTest(amount: number): void {
    this.terminal.scrollLines(amount);
  }

  constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
    this.socketPath = getIpcEndpointPath(sessionKey);
    this.startedAt = Date.now();
    this.airelayVersion = getAirelayVersion();
    this.protocolVersion = CONTROLLER_PROTOCOL_VERSION;
    this.terminal = new Terminal({
      cols: VIEWPORT_COLS,
      rows: VIEWPORT_ROWS,
      allowProposedApi: true,
    });
  }

  get endpointPath(): string {
    return this.socketPath;
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.terminal.resize(cols, rows);
  }

  /** Flush pending xterm writes, returning when all data is processed. */
  flushViewport(): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write('', resolve);
    });
  }

  /**
   * Feed raw terminal output. Written to the headless xterm terminal
   * for true viewport tracking, to the historical ring buffer, to the
   * bounded raw bootstrap ring, and broadcast losslessly to every attached
   * stream client. Chunks are delivered in order; per-socket memory is
   * bounded by the write buffering cap.
   */
  feedOutput(chunk: string): void {
    if (chunk.trim()) {
      this.lastOutputChangeAt = Date.now();
    }
    this.terminal.write(chunk);
    const lines = chunk.split('\n');
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed) {
        this.outputBuf.push(trimmed);
      }
    }
    while (this.outputBuf.length > this.MAX_OUTPUT_LINES) {
      this.outputBuf.shift();
    }
    this.rawRing.push(chunk);
    this.rawRingBytes += chunk.length;
    while (this.rawRing.length > RAW_RING_MAX_CHUNKS || this.rawRingBytes > RAW_RING_MAX_BYTES) {
      const dropped = this.rawRing.shift();
      if (dropped) this.rawRingBytes -= dropped.length;
    }
    for (const socket of this.attachedClients) {
      this.writeStreamFrame(socket, chunk);
    }
  }

  /**
   * Write one raw stream frame to an attached client. Enforces a per-socket
   * buffered-bytes cap: a client that cannot keep up is detached instead of
   * growing memory without bound.
   */
  private writeStreamFrame(socket: net.Socket, chunk: string): void {
    if (socket.destroyed) return;
    if (socket.writableLength > STREAM_MAX_BUFFERED_BYTES) {
      socket.destroy();
      return;
    }
    try {
      socket.write(serializeStreamFrame(chunk));
    } catch {
      socket.destroy();
    }
  }

  /** Capture a snapshot of current viewport lines into the rolling window. */
  takeSnapshot(): void {
    const current = this.getLiveViewportLines();
    for (const line of current) {
      if (!this.snapshotLineSet.has(line)) {
        this.snapshotLineSet.add(line);
        this.snapshotWindow.push(line);
      }
    }
    while (this.snapshotWindow.length > MAX_SNAPSHOT_LINES) {
      const removed = this.snapshotWindow.shift();
      if (removed) this.snapshotLineSet.delete(removed);
    }
    if (!this.transcriptPersistenceEnabled) return;

    const rendered = this.getTranscriptViewportLines();
    if (!this.lastTranscriptLines) {
      this.lastTranscriptLines = rendered;
      return;
    }

    const changedLines: string[] = [];
    for (let i = 0; i < rendered.length; i++) {
      if (
        rendered[i] !== this.lastTranscriptLines[i] &&
        rendered[i].length > 0 &&
        !isTranscriptStatusFooter(rendered[i])
      ) {
        changedLines.push(rendered[i]);
      }
    }
    if (changedLines.length > 0) {
      this.queueTranscriptLines(changedLines);
    }
    this.lastTranscriptLines = rendered;
  }

  private queueTranscriptLines(lines: string[]): void {
    this.pendingTranscriptLines = lines;
    if (this.pendingTranscriptTimer) clearTimeout(this.pendingTranscriptTimer);
    this.pendingTranscriptTimer = setTimeout(() => {
      this.pendingTranscriptTimer = null;
      if (this.pendingTranscriptLines) {
        appendTranscriptSnapshot(this.sessionKey, this.pendingTranscriptLines);
        this.pendingTranscriptLines = null;
      }
    }, TRANSCRIPT_STABILITY_DELAY);
  }

  private getTranscriptViewportLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const rows: string[] = [];
    for (let y = buffer.baseY; y < buffer.baseY + this.terminal.rows; y++) {
      const line = buffer.getLine(y);
      rows.push(line ? line.translateToString(true).trimEnd() : '');
    }
    return rows;
  }

  /**
   * Read current visible viewport lines from the xterm terminal buffer.
   * Starts at buffer.viewportY (top of the currently displayed viewport),
   * not baseY (top of the bottom scrollback page) which may be scrolled off.
   */
  getLiveViewportLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const rows: string[] = [];
    for (let y = buffer.viewportY; y < buffer.viewportY + this.terminal.rows; y++) {
      const line = buffer.getLine(y);
      if (line) {
        const text = line.translateToString().trim();
        if (text) {
          rows.push(text);
        }
      }
    }
    return rows;
  }

  /** Return rolling snapshot window (which includes recent historical viewport + current). */
  getViewportSnapshot(): string[] {
    const current = this.getLiveViewportLines();
    // Merge: snapshot window first (historical), then current viewport lines not in snapshot
    const result = [...this.snapshotWindow];
    const seen = new Set(this.snapshotWindow);
    for (const line of current) {
      if (!seen.has(line)) {
        result.push(line);
        seen.add(line);
      }
    }
    return result;
  }

  onRequest(handler: IpcHandler): void {
    this.handler = handler;
  }

  setDeliveryStatusProvider(provider: () => DeliveryStatus | undefined): void {
    this.deliveryStatusProvider = provider;
  }

  /** Register the canonical semantic availability state for this session. */
  setActivityStateProvider(provider: () => 'busy' | 'idle'): void {
    this.activityStateProvider = provider;
  }

  async start(): Promise<void> {
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.transcriptPersistenceEnabled = true;

    // Start periodic snapshot timer
    this.snapshotTimer = setInterval(() => {
      this.takeSnapshot();
    }, SNAPSHOT_INTERVAL);

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';
        let decoder = new TextDecoder('utf-8', { fatal: true });

        socket.on('data', (chunk: Buffer) => {
          try {
            const decoded = decoder.decode(chunk, { stream: true });
            buffer = readLines(buffer + decoded, (line) => {
              this.handleMessage(line, socket);
            });
          } catch {
            // Do not let Node's replacement-character decoding turn malformed
            // request bytes into a different, apparently valid prompt.
            decoder = new TextDecoder('utf-8', { fatal: true });
            buffer = '';
            const response = createErrorResponse(
              null,
              IpcErrorCodes.PARSE_ERROR,
              'Malformed UTF-8: failed to decode request bytes',
              IpcErrorReasons.INVALID_ENCODING
            );
            try {
              socket.write(serializeResponse(response));
            } catch {
              // Ignore write errors; the client may already be gone.
            }
          }
        });

        socket.on('close', () => {
          if (this.attachedClients.delete(socket)) {
            this.onAttachedChangeCb?.(this.attachedClients.size);
          }
        });

        socket.on('error', () => {
          // Socket errors are non-fatal
        });
      });

      this.server.on('error', (err: Error) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  private async handleMessage(raw: string, socket: net.Socket): Promise<void> {
    let response: IpcResponse;
    try {
      const request = parseRequest(raw);

      if (request.method === 'ping') {
        response = createSuccessResponse(request.id, { pong: true });
      } else if (request.method === 'session.attach') {
        this.attachedClients.add(socket);
        this.onAttachedChangeCb?.(this.attachedClients.size);
        // Bounded lossless bootstrap. This block runs synchronously (no await):
        // the client is registered, the raw-output ring is replayed, and the
        // success response is written back-to-back, so no PTY output callback
        // can interleave. Live chunks arriving afterwards are appended after
        // the replay because socket.write preserves call order. Therefore the
        // client observes [replay, success, live] with no lost or duplicated
        // bytes at the attach boundary.
        for (const chunk of this.rawRing) {
          this.writeStreamFrame(socket, chunk);
        }
        response = createSuccessResponse(request.id, { attached: this.attachedClients.size });
      } else if (request.method === 'session.detach') {
        if (this.attachedClients.delete(socket)) {
          this.onAttachedChangeCb?.(this.attachedClients.size);
        }
        response = createSuccessResponse(request.id, { attached: this.attachedClients.size });
      } else if (request.method === 'session.input.raw') {
        // Narrow PTY input operation for the attach client. Deliberately
        // fire-and-forget: no response is written, so raw input is never
        // queued behind a viewport poll and no Enter is ever appended.
        if (this.handler) {
          try {
            await this.handler(request);
          } catch {
            // Raw input dropped silently; the runtime may be mid-shutdown.
          }
        }
        return;
      } else if (request.method === 'session.resize') {
        if (this.handler) {
          try {
            await this.handler(request);
          } catch {
            // Resize dropped silently; the runtime may be mid-shutdown.
          }
        }
        return;
      } else if (request.method === 'session.info') {
        response = createSuccessResponse(request.id, {
          sessionKey: this.sessionKey,
          active: !!this.handler,
          state: this.activityStateProvider?.(),
          airelayVersion: this.airelayVersion,
          controllerProtocolVersion: this.protocolVersion,
          startedAt: this.startedAt,
          lastOutputChangeAt: this.lastOutputChangeAt,
          delivery: this.deliveryStatusProvider?.(),
          attached: this.attachedClients.size,
        });
      } else if (request.method === 'session.output') {
        response = createSuccessResponse(request.id, { lines: this.outputBuf });
      } else if (request.method === 'session.viewport') {
        await this.flushViewport();
        response = createSuccessResponse(request.id, { lines: this.getLiveViewportLines() });
      } else if (request.method === 'session.interrupt') {
        if (!this.handler) {
          response = createErrorResponse(
            request.id,
            IpcErrorCodes.INTERNAL_ERROR,
            'No handler registered for this controller',
            IpcErrorReasons.CONTROLLER_UNAVAILABLE
          );
        } else {
          const data = await this.handler(request);
          response = createSuccessResponse(request.id, data);
        }
      } else if (this.handler) {
        const data = await this.handler(request);
        response = createSuccessResponse(request.id, data);
      } else {
        response = createErrorResponse(
          request.id,
          IpcErrorCodes.INTERNAL_ERROR,
          'No handler registered for this controller',
          IpcErrorReasons.CONTROLLER_UNAVAILABLE
        );
      }
    } catch (err) {
      if (err instanceof IpcError) {
        response = createErrorResponse(null, err.code, err.message, err.reason);
      } else {
        response = createErrorResponse(
          null,
          IpcErrorCodes.INTERNAL_ERROR,
          'Internal server error',
          IpcErrorReasons.INTERNAL_ERROR
        );
      }
    }

    try {
      socket.write(serializeResponse(response));
    } catch {
      // Ignore write errors
    }
  }

  async stop(): Promise<void> {
    this.transcriptPersistenceEnabled = false;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.pendingTranscriptTimer) {
      clearTimeout(this.pendingTranscriptTimer);
      this.pendingTranscriptTimer = null;
    }
    return new Promise((resolve) => {
      const server = this.server;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cleanupSocket();
        resolve();
      };
      if (!server) {
        this.cleanupSocket();
        resolve();
        return;
      }
      // Force-close attached stream clients so server.close() completes
      // promptly. Previously a raw-input client that never disconnected could
      // keep server.close() waiting forever, leaving the runtime process alive
      // with a dead controller and an unusable, live-looking registry/session.
      for (const sock of this.attachedClients) {
        sock.destroy();
      }
      this.attachedClients.clear();
      this.onAttachedChangeCb?.(0);
      // Bounded fallback: never allow shutdown to hang on a stuck connection.
      const timer = setTimeout(() => {
        try {
          (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        } catch {
          // Ignore close errors
        }
        finish();
      }, STOP_TIMEOUT_MS);
      try {
        if (server.listening) {
          server.close(finish);
        } else {
          finish();
        }
      } catch {
        finish();
      }
    });
  }

  private cleanupSocket(): void {
    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
