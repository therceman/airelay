import { EventEmitter } from 'events';
import { promptCommand } from '../src/commands/prompt';

// Capture the mock socket instance for each test
let mockSocketInstance: MockSocket | null;

class MockSocket extends EventEmitter {
  connect = jest.fn((_path: string, cb?: () => void) => {
    if (cb) {
      cb();
    }
  });
  write = jest.fn();
  destroy = jest.fn();
}

jest.mock('net', () => ({
  Socket: jest.fn(() => {
    mockSocketInstance = new MockSocket();
    return mockSocketInstance;
  }),
}));

jest.mock('../src/commands/sessions', () => ({
  findSessionByKey: jest.fn(),
}));

jest.mock('../src/config/load', () => ({
  loadConfig: jest.fn(() => ({
    profiles: {
      codexprof: { executable: 'codex' },
      testprofile: { executable: 'opencode' },
    },
  })),
}));

import { findSessionByKey } from '../src/commands/sessions';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  mockSocketInstance = null;
  jest.clearAllMocks();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
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

function emitData(data: Record<string, unknown>): void {
  if (!mockSocketInstance) {
    throw new Error('No mock socket instance');
  }
  mockSocketInstance.emit('data', Buffer.from(JSON.stringify(data) + '\n'));
}

function emitError(err: Error & { code?: string }): void {
  if (!mockSocketInstance) {
    throw new Error('No mock socket instance');
  }
  mockSocketInstance.emit('error', err);
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
  });

  describe('IPC success', () => {
    it('sends session.input and returns 0 on success', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'write a test');

      // Simulate successful IPC connection
      emitData({ id: 'prompt-1', type: 'success', data: {} });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Prompt sent successfully'));
    });

    it('includes enter as submit byte by default', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      // Default for opencode/unknown profiles is "\r" (Enter)
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"enter":"\\r"'));
    });

    it('passes enter:false when options.enter is false', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello', { enter: false });

      emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.write).toHaveBeenCalledWith(expect.stringContaining('"enter":false'));
    });
  });

  describe('IPC errors', () => {
    it('handles IPC error response from controller', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      emitData({
        id: 'prompt-1',
        type: 'error',
        error: { code: 'INVALID_PARAMS', message: 'bad input' },
      });

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('IPC error from controller')
      );
    });

    it('handles controller offline (ENOENT)', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      const err = new Error('connect ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      emitError(err);

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
      emitError(err);

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Controller offline'));
    });

    it('handles IPC timeout', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      const err = new Error('IPC request timed out');
      emitError(err);

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    });

    it('handles invalid IPC response (non-JSON)', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      if (!mockSocketInstance) {
        throw new Error('No mock socket instance');
      }
      mockSocketInstance.emit('data', Buffer.from('not valid json\n'));

      const exitCode = await exitCodePromise;
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid IPC response'));
    });
  });

  describe('session key fallback', () => {
    it('uses sessionKey when available', async () => {
      mockSessionFound();
      const exitCodePromise = promptCommand('testprofile_1234', 'hello');

      emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.connect).toHaveBeenCalledWith(
        expect.stringContaining('testprofile_1234'),
        expect.any(Function)
      );
    });

    it('sends Enter (\\r) with submitDelayMs for codex harness profile', async () => {
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

      emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;

      const written = socket?.write.mock.calls[0][0];
      // codex now uses Enter (\r) with a delay
      expect(written).toContain('"enter":"\\r"');
      expect(written).toContain('"submitDelayMs":500');
    });

    it('falls back to session.id when sessionKey is missing', async () => {
      mockSessionFound({ sessionKey: undefined });
      const exitCodePromise = promptCommand('ses_abcdef123456', 'hello');

      emitData({ id: 'prompt-1', type: 'success', data: {} });

      await exitCodePromise;
      const socket = mockSocketInstance;
      expect(socket?.connect).toHaveBeenCalledWith(
        expect.stringContaining('ses_abcdef123456'),
        expect.any(Function)
      );
    });
  });
});
