import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { promptCommand } from '../src/commands/prompt';

// Capture the mock socket instances for each test
let mockSocketInstances: MockSocket[] = [];
let mockSocketInstance: MockSocket | null = null;

class MockSocket extends EventEmitter {
  connect = jest.fn((_path: string, cb?: () => void) => {
    if (cb) {
      cb();
    }
  });
  write = jest.fn();
  destroy = jest.fn(() => {
    this.emit('close');
  });
  setTimeout = jest.fn();
}

jest.mock('net', () => ({
  Socket: jest.fn(() => {
    const sock = new MockSocket();
    mockSocketInstances.push(sock);
    mockSocketInstance = sock;
    return sock;
  }),
}));

jest.mock('../src/commands/sessions', () => ({
  findSessionByKey: jest.fn(),
  pruneStaleSessions: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/config/load', () => ({
  loadConfig: jest.fn(() => ({
    profiles: {
      codexprof: { executable: 'codex' },
      testprofile: { executable: 'opencode' },
    },
  })),
}));

jest.mock('../src/commands/session-ipc', () => ({
  preflightVersionCheck: jest.fn().mockResolvedValue({ ok: true, warnings: [] }),
}));

import { findSessionByKey } from '../src/commands/sessions';
import { preflightVersionCheck } from '../src/commands/session-ipc';
import { loadConfig } from '../src/config/load';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  mockSocketInstance = null;
  mockSocketInstances = [];
  jest.clearAllMocks();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

function mockSessionFound(overrides: Record<string, unknown> = {}): void {
  (findSessionByKey as jest.Mock).mockReturnValue({
    profile: 'testprofile',
    session: {
      id: 'ses_abcdef123456',
      sessionKey: 'testprofile_1234',
      profile: 'testprofile',
      lastUsed: Date.now(),
      ...overrides,
    },
  });
}

function mockSessionNotFound(): void {
  (findSessionByKey as jest.Mock).mockReturnValue(null);
}

async function emitData(data: Record<string, unknown>): Promise<void> {
  // Wait for the main IPC request to create its socket
  while (mockSocketInstances.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const sock = mockSocketInstances[mockSocketInstances.length - 1];
  if (!sock) throw new Error('No mock socket instance');
  sock.emit('data', Buffer.from(JSON.stringify(data) + '\n'));
}

async function emitError(err: Error & { code?: string }): Promise<void> {
  while (mockSocketInstances.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const sock = mockSocketInstances[mockSocketInstances.length - 1];
  if (!sock) throw new Error('No mock socket instance');
  sock.emit('error', err);
}

async function emitRetryableErrorTwice(err: Error & { code?: string }): Promise<void> {
  await emitError(err);
  while (mockSocketInstances.length < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await emitError(err);
}

describe('promptCommand', () => {
  describe('validation', () => {
    it('returns error when no text provided', async () => {
      const exitCode = await promptCommand('session123');
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Text is required'));
    });

    it('returns error when session not found', async () => {
      mockSessionNotFound();
      const exitCode = await promptCommand('unknown_session', 'hello');
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Session not found'));
    });

    it('allows prompts longer than 512 characters by default', async () => {
      mockSessionFound();

      const allowedPromise = promptCommand('testprofile_1234', 'x'.repeat(513));
      await emitData({ id: 'prompt-1', type: 'success', data: {} });
      expect(await allowedPromise).toBe(0);
    });

    it('uses the configured prompt max length', async () => {
      (loadConfig as jest.Mock).mockReturnValueOnce({
        profiles: {
          codexprof: { executable: 'codex' },
          testprofile: { executable: 'opencode' },
        },
        settings: { promptMaxLength: 4 },
      });
      mockSessionFound();

      const exitCode = await promptCommand('testprofile_1234', '12345');

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'Error: Prompt is too long (5 characters). Maximum is 4.'
      );
    });

    it('allows prompts of any length when configured as -1', async () => {
      (loadConfig as jest.Mock).mockReturnValueOnce({
        profiles: {
          codexprof: { executable: 'codex' },
          testprofile: { executable: 'opencode' },
        },
        settings: { promptMaxLength: -1 },
      });
      mockSessionFound();

      const promptPromise = promptCommand('testprofile_1234', '😀'.repeat(513));
      await emitData({ id: 'prompt-unlimited', type: 'success', data: {} });

      expect(await promptPromise).toBe(0);
    });

    it('counts an emoji as one prompt character', async () => {
      (loadConfig as jest.Mock).mockReturnValueOnce({
        profiles: {
          codexprof: { executable: 'codex' },
          testprofile: { executable: 'opencode' },
        },
        settings: { promptMaxLength: 1 },
      });
      mockSessionFound();

      const promptPromise = promptCommand('testprofile_1234', '😀');
      await emitData({ id: 'prompt-emoji', type: 'success', data: {} });

      expect(await promptPromise).toBe(0);
    });
  });

  describe('IPC success', () => {
    it('sends session.input and returns 0 on success', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'write a test');

      // Simulate successful IPC connection
      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Prompt sent successfully'));
    });

    it('includes enter as submit byte by default', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      // Default for opencode/unknown profiles is "\r" (Enter)
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"enter":"\\r"'));
    });

    it('passes enter:false when options.enter is false', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello', { enter: false });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"enter":false'));
    });

    it('reuses the same delivery id across a transport retry', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello', {
        deliveryId: 'delivery-1',
      });

      while (mockSocketInstances.length < 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const firstSocket = mockSocketInstances[0];
      while (!firstSocket?.write.mock.calls.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const transportError = new Error('connect ECONNREFUSED') as Error & { code?: string };
      transportError.code = 'ECONNREFUSED';
      firstSocket.emit('error', transportError);

      while (mockSocketInstances.length < 2) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const secondSocket = mockSocketInstances[1];
      while (!secondSocket?.write.mock.calls.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const firstRequest = JSON.parse(firstSocket.write.mock.calls[0][0] as string);
      const secondRequest = JSON.parse(secondSocket.write.mock.calls[0][0] as string);
      expect(secondRequest.params.deliveryId).toBe('delivery-1');
      expect(secondRequest.id).toBe(firstRequest.id);

      secondSocket.emit(
        'data',
        Buffer.from(JSON.stringify({ id: secondRequest.id, type: 'success' }) + '\n')
      );
      expect(await exitCodePromise).toBe(0);
    });
  });

  describe('IPC errors', () => {
    it('handles IPC error response from controller', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      emitData({
        id: 'prompt-1',
        type: 'error',
        error: { code: 'INVALID_PARAMS', message: 'bad input', reason: 'too_long' },
      });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[reason=too_long]'));
    });

    it('handles controller offline (ENOENT)', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      const err = new Error('connect ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      await emitRetryableErrorTwice(err);

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Controller offline'));
    });

    it('handles controller offline (ECONNREFUSED)', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      const err = new Error('connect ECONNREFUSED') as Error & {
        code?: string;
      };
      err.code = 'ECONNREFUSED';
      await emitRetryableErrorTwice(err);

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Controller offline'));
    });

    it('handles IPC timeout', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      const err = new Error('IPC request timed out');
      await emitRetryableErrorTwice(err);

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    });

    it('handles invalid IPC response (non-JSON)', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      while (mockSocketInstances.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const sock = mockSocketInstances[mockSocketInstances.length - 1];
      sock.emit('data', Buffer.from('not valid json\n'));

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid IPC response'));
    });
  });

  describe('sender prefix', () => {
    beforeEach(() => {
      delete process.env.AIRELAY_SESSION_KEY;
    });

    it('prefixes text with @<sender>: from env var', async () => {
      process.env.AIRELAY_SESSION_KEY = 'worker_1';
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'ping');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"[from=worker_1] ping"');
    });

    it('--no-sender disables prefix even with env var', async () => {
      process.env.AIRELAY_SESSION_KEY = 'worker_1';
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'ping', { noSender: true });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"ping"');
      expect(written).not.toContain('[from=');
    });

    it('--sender overrides env var', async () => {
      process.env.AIRELAY_SESSION_KEY = 'worker_1';
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'ping', {
        sender: 'custom_sender',
      });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"[from=custom_sender] ping"');
    });

    it('does not add prefix when no env var and no options', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'ping');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"ping"');
    });

    it('does not prefix text with --no-sender when no env var', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'ping', { noSender: true });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"ping"');
    });
  });

  describe('version parity blocking', () => {
    beforeEach(() => {
      mockSessionFound();
      (preflightVersionCheck as jest.Mock).mockResolvedValue({
        ok: true,
        warnings: [],
      });
    });

    afterEach(() => {
      (preflightVersionCheck as jest.Mock).mockClear();
    });

    it('major mismatch returns non-zero and does not send IPC request', async () => {
      (preflightVersionCheck as jest.Mock).mockResolvedValue({
        ok: false,
        error: 'Version incompatible',
        warnings: [],
      });

      const exitCode = await promptCommand('testprofile_1234', 'hello');
      expect(exitCode).toBe(1);
      expect(mockSocketInstances.length).toBe(0);
    });

    it('same-major older warns and proceeds', async () => {
      (preflightVersionCheck as jest.Mock).mockResolvedValue({
        ok: true,
        warnings: ['Controller is older than CLI.'],
      });

      const exitCodePromise = promptCommand('testprofile_1234', 'hello');
      await emitData({ id: 'prompt-1', type: 'success', data: {} });
      const exitCode = await exitCodePromise;

      expect(exitCode).toBe(0);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('older'));
    });
  });

  describe('session key fallback', () => {
    it('uses sessionKey when available', async () => {
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.connect).toHaveBeenCalledWith(
        expect.stringContaining('testprofile_1234'),
        expect.any(Function)
      );
    });

    it('sends Enter (\\r) with reduced submitDelayMs for codex harness profile', async () => {
      (findSessionByKey as jest.Mock).mockReturnValue({
        profile: 'codexprof',
        session: {
          id: 'ses_codex123',
          sessionKey: 'codexprof_abcd',
          profile: 'codexprof',
          lastUsed: Date.now(),
        },
      });

      const exitCodePromise = promptCommand('codexprof_abcd', 'submit via codex');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;

      const written = socket?.write.mock.calls[0][0];
      // codex now uses Enter (\r) with the reduced submit delay
      expect(written).toContain('"enter":"\\r"');
      expect(written).toContain('"submitDelayMs":250');
    });

    it('uses the reduced submit delay for the ordinary prompt path', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"submitDelayMs":250'));
    });

    it('fastEnter overrides the submit delay to 0', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello', { fastEnter: true });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"submitDelayMs":0'));
    });

    it('falls back to session.id when sessionKey is missing', async () => {
      mockSessionFound({ sessionKey: undefined });
      const exitCodePromise = promptCommand('ses_abcdef123456', 'hello');

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.connect).toHaveBeenCalledWith(
        expect.stringContaining('ses_abcdef123456'),
        expect.any(Function)
      );
    });
  });

  describe('stdin mode', () => {
    const originalStdin = process.stdin;

    afterEach(() => {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
        writable: true,
      });
    });

    function mockStdin(input: string, isTTY = false): void {
      const stream = new Readable({
        read() {
          this.push(Buffer.from(input));
          this.push(null);
        },
      });
      (stream as unknown as { isTTY: boolean }).isTTY = isTTY;
      Object.defineProperty(process, 'stdin', {
        value: stream,
        configurable: true,
        writable: true,
      });
    }

    function mockStdinEmpty(): void {
      const stream = new Readable({
        read() {
          this.push(null);
        },
      });
      (stream as unknown as { isTTY: boolean }).isTTY = false;
      Object.defineProperty(process, 'stdin', {
        value: stream,
        configurable: true,
        writable: true,
      });
    }

    it('reads text from stdin and sends to session', async () => {
      mockStdin('hello from stdin');
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', undefined, { stdin: true });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(0);
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"hello from stdin"');
    });

    it('preserves multi-line payload from stdin', async () => {
      mockStdin('line one\nline two\nline three');
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', undefined, { stdin: true });

      await emitData({ id: 'prompt-1', type: 'success', data: {} });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(0);
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"line one\\nline two\\nline three"');
    });

    it('returns error when stdin is empty', async () => {
      mockStdinEmpty();
      const exitCode = await promptCommand('testprofile_1234', undefined, { stdin: true });
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Empty input'));
    });

    it('returns error when --stdin combined with inline text', async () => {
      const exitCode = await promptCommand('testprofile_1234', 'inline text', { stdin: true });
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('cannot be combined'));
    });

    it('existing non-stdin prompt still works', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'normal text');
      await emitData({ id: 'prompt-1', type: 'success', data: {} });
      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(0);
      const socket = mockSocketInstance;
      const written = socket?.write.mock.calls[0][0];
      expect(written).toContain('"text":"normal text"');
    });
  });
});
