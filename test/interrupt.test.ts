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
      getActiveTurnId: () => 1,
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
      getActiveTurnId: () => undefined,
      isWorking: () => false,
    }).request();
    const idle = await new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => undefined,
      getActiveTurnId: () => 1,
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
      getActiveTurnId: () => (active ? 1 : undefined),
      isWorking: (turnId) => turnId === 1 && working,
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

  it('returns the same in-flight result for a repeated interrupt request', async () => {
    let working = true;
    const controller = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => {
        working = false;
      },
      getActiveTurnId: () => 1,
      isWorking: (turnId) => turnId === 1 && working,
    });

    const first = controller.request();
    const repeated = controller.request();

    expect(repeated).toBe(first);
    expect((await repeated).outcome).toBe('interrupt_acknowledged');
  });

  it('can interrupt a later turn on the same controller after acknowledgement', async () => {
    let turnActive = true;
    let turnId = 1;
    let working = true;
    const writes: string[] = [];
    const controller = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => (data) => {
        writes.push(data);
        working = false;
      },
      getActiveTurnId: () => (turnActive ? turnId : undefined),
      isWorking: (activeTurnId) => activeTurnId === turnId && working,
      onAcknowledged: () => {
        turnActive = false;
      },
    });

    expect((await controller.request()).outcome).toBe('interrupt_acknowledged');
    turnId = 2;
    turnActive = true;
    working = true;
    expect((await controller.request()).outcome).toBe('interrupt_acknowledged');
    expect(writes).toEqual(['\x03', '\x03']);
  });

  it('rejects a stale turn A interrupt when turn B replaces it before polling', async () => {
    let activeTurn = 1;
    let working = true;
    const writes: string[] = [];
    const onAcknowledged = jest.fn();
    const controller = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => (data) => {
        writes.push(data);
        if (writes.length >= 2) working = false;
      },
      getActiveTurnId: () => activeTurn,
      isWorking: (turnId) => turnId === activeTurn && working,
      onAcknowledged,
    });

    const turnAPromise = controller.request();
    activeTurn = 2;
    working = true;
    await jest.advanceTimersByTimeAsync(10);
    const turnA = await turnAPromise;

    expect(turnA).toMatchObject({
      outcome: 'failed',
      requested: true,
      reason: 'turn_changed',
    });
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(activeTurn).toBe(2);
    expect(working).toBe(true);

    const turnB = await controller.request();
    expect(turnB).toMatchObject({ outcome: 'interrupt_acknowledged', requested: true });
    expect(writes).toEqual(['\x03', '\x03']);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
  });

  it('does not let turn A cleanup clear turn B in-flight state', async () => {
    let activeTurn = 1;
    let working = true;
    const controller = new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => undefined,
      getActiveTurnId: () => activeTurn,
      isWorking: (turnId) => turnId === activeTurn && working,
    });

    const turnA = controller.request();
    activeTurn = 2;
    const turnB = controller.request();
    expect(controller.request()).toBe(turnB);

    await jest.advanceTimersByTimeAsync(10);
    expect((await turnA).reason).toBe('turn_changed');
    expect(controller.request()).toBe(turnB);

    working = false;
    await jest.advanceTimersByTimeAsync(10);
    expect((await turnB).outcome).toBe('interrupt_acknowledged');
  });

  it('returns failed when the PTY write throws', async () => {
    const result = await new InterruptController({
      value: '\x03',
      ackTimeoutMs: 100,
      pollIntervalMs: 10,
      write: () => () => {
        throw new Error('pty closed');
      },
      getActiveTurnId: () => 1,
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
      getActiveTurnId: () => 1,
      isWorking: () => true,
    }).request();

    await jest.advanceTimersByTimeAsync(101);
    const result = await resultPromise;

    expect(result).toMatchObject({ outcome: 'timed_out', requested: true });
    expect(jest.getTimerCount()).toBe(0);
  });
});
