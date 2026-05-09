import { heartbeatCommand } from '../src/commands/heartbeat';
import { promptCommand } from '../src/commands/prompt';

jest.mock('../src/commands/prompt', () => ({
  promptCommand: jest.fn(),
}));

const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  (promptCommand as jest.Mock).mockResolvedValue(0);
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  jest.clearAllMocks();
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('heartbeatCommand', () => {
  it('sends heartbeat payload and exits cleanly on SIGINT', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    const exitCode = await exitPromise;

    expect(exitCode).toBe(0);
    expect(promptCommand).toHaveBeenCalledWith(
      'test_session',
      '[from=cron] heartbeat',
      expect.objectContaining({ enter: true })
    );
  });

  it('uses intervalMs from options', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    await exitPromise;
    expect(promptCommand).toHaveBeenCalledTimes(1);
  });

  it('returns non-zero when promptCommand fails', async () => {
    (promptCommand as jest.Mock).mockResolvedValue(1);
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    const exitCode = await exitPromise;
    expect(exitCode).toBe(1);
  });

  it('passes noWarn option to promptCommand', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      noWarn: true,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    await exitPromise;
    expect(promptCommand).toHaveBeenCalledWith(
      'test_session',
      '[from=cron] heartbeat',
      expect.objectContaining({ noWarn: true })
    );
  });

  it('prints lifecycle logs', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    await exitPromise;
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Heartbeat started'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('heartbeat sent'));
  });

  it('heartbeat payload is exactly [from=cron] heartbeat', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    await exitPromise;
    expect(promptCommand).toHaveBeenCalledWith(
      'test_session',
      '[from=cron] heartbeat',
      expect.any(Object)
    );
  });

  it('exits cleanly after duration expires', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 5,
      durationMs: 15,
    });
    await tick(60);
    const exitCode = await exitPromise;

    expect(exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Heartbeat duration reached'));
  });

  it('early SIGINT still stops before duration expires', async () => {
    const exitPromise = heartbeatCommand('test_session', {
      intervalMs: 10000,
      durationMs: 60000,
    });
    await tick(30);
    process.emit('SIGINT');
    const exitCode = await exitPromise;

    expect(exitCode).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Heartbeat stopped.'));
  });
});
