import net from 'net';
import fs from 'fs';
import path from 'path';
import { Terminal } from '@xterm/headless';
import { IpcRequest, IpcResponse, IpcError, IpcErrorCodes } from '../types/controller';
import {
  parseRequest,
  createSuccessResponse,
  createErrorResponse,
  serializeResponse,
  readLines,
} from './protocol';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { getAirelayVersion, CONTROLLER_PROTOCOL_VERSION } from '../utils/version';

const VIEWPORT_ROWS = 30;
const VIEWPORT_COLS = 120;

export type IpcHandler = (request: IpcRequest) => Promise<unknown> | unknown;

export class SessionController {
  private server: net.Server | null = null;
  private socketPath: string;
  private handler: IpcHandler | null = null;
  /** Historical ring buffer (100 lines) — exposed via session.output */
  private outputBuf: string[] = [];
  private readonly MAX_OUTPUT_LINES = 100;
  private readonly sessionKey: string;
  private readonly startedAt: number;
  private readonly airelayVersion: string;
  private readonly protocolVersion: number;
  /** Headless xterm terminal — maintains true visible screen state */
  private readonly terminal: Terminal;

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

  /** Flush pending xterm writes, returning when all data is processed. */
  flushViewport(): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write('', resolve);
    });
  }

  /**
   * Feed raw terminal output. Written to the headless xterm terminal
   * for true viewport tracking and to the historical ring buffer.
   */
  feedOutput(chunk: string): void {
    // Feed into xterm for proper screen state tracking
    this.terminal.write(chunk);

    // Also feed into historical ring buffer
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
  }

  /** Read current visible viewport lines from the xterm terminal buffer. */
  getViewportSnapshot(): string[] {
    const buffer = this.terminal.buffer.active;
    const rows: string[] = [];
    // baseY is the scroll offset; visible rows start at baseY
    for (let y = buffer.baseY; y < buffer.baseY + this.terminal.rows; y++) {
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

  onRequest(handler: IpcHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', (chunk: Buffer) => {
          buffer = readLines(buffer + chunk.toString(), (line) => {
            this.handleMessage(line, socket);
          });
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
      } else if (request.method === 'session.info') {
        response = createSuccessResponse(request.id, {
          sessionKey: this.sessionKey,
          active: !!this.handler,
          airelayVersion: this.airelayVersion,
          controllerProtocolVersion: this.protocolVersion,
          startedAt: this.startedAt,
        });
      } else if (request.method === 'session.output') {
        response = createSuccessResponse(request.id, { lines: this.outputBuf });
      } else if (request.method === 'session.viewport') {
        response = createSuccessResponse(request.id, { lines: this.getViewportSnapshot() });
      } else if (this.handler) {
        const data = await this.handler(request);
        response = createSuccessResponse(request.id, data);
      } else {
        response = createErrorResponse(
          request.id,
          IpcErrorCodes.INTERNAL_ERROR,
          'No handler registered for this controller'
        );
      }
    } catch (err) {
      if (err instanceof IpcError) {
        response = createErrorResponse(null, err.code, err.message);
      } else {
        response = createErrorResponse(null, IpcErrorCodes.INTERNAL_ERROR, 'Internal server error');
      }
    }

    try {
      socket.write(serializeResponse(response));
    } catch {
      // Ignore write errors
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.cleanupSocket();
          resolve();
        });
      } else {
        resolve();
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
