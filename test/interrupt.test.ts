import { InterruptController } from '../src/runtime/interrupt';

describe('interrupt controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns unsupported without a configured native control', async () => {
    const result = await new InterruptController({
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => null,
      isActive: () => true,
      isWorking: () => true,
    }).request();

    expect(result).toEqual({ outcome: 'unsupported', requested: false });
  });

  it('distinguishes no active and already idle turns', async () => {
    const noActive = await new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => undefined,
      isActive: () => false,
      isWorking: () => false,
    }).request();
    const idle = await new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => undefined,
      isActive: () => true,
      isWorking: () => false,
    }).request();

    expect(noActive.outcome).toBe('no_active_turn');
    expect(idle.outcome).toBe('already_idle');
  });

  it('acknowledges only after the working state clears and remains reusable', async () => {
    let active = true;
    let working = true;
    const writes: string[] = [];
    const onAcknowledged = jest.fn();
    const controller = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => (data) => {
        writes.push(data);
        working = false;
      },
      isActive: () => active,
      isWorking: () => working,
      onAcknowledged: () => {
        active = false;
        onAcknowledged();
      },
    });

    const result = await controller.request();
    const repeated = await controller.request();

    expect(result).toMatchObject({ outcome: 'interrupt_acknowledged', requested: true });
    expect(repeated.outcome).toBe('no_active_turn');
    expect(writes).toEqual(['\x03']);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
  });

  it('returns failed when the PTY write throws', async () => {
    const result = await new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => {
        throw new Error('pty closed');
      },
      isActive: () => true,
      isWorking: () => true,
    }).request();

    expect(result).toMatchObject({ outcome: 'failed', requested: false, error: 'pty closed' });
  });

  it('returns timed_out without falsely acknowledging', async () => {
    const resultPromise = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => undefined,
      isActive: () => true,
      isWorking: () => true,
    }).request();

    await jest.advanceTimersByTimeAsync(101);
    const result = await resultPromise;

    expect(result).toMatchObject({ outcome: 'timed_out', requested: true });
  });
});
