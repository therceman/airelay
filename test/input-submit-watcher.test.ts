import { InputSubmitWatcher } from '../src/runtime/input-submit-watcher';
import { getHarnessCapabilities } from '../src/utils/harness';

describe('input submit watcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createWatcher(visible: () => boolean, writes: string[]): InputSubmitWatcher {
    return new InputSubmitWatcher({
      retryDelayMs: 2500,
      maxRetries: 3,
      write: () => (data) => writes.push(data),
      isInputVisible: visible,
    });
  }

  it('declares the audited half retry timeout for codex', () => {
    expect(getHarnessCapabilities('codex').inputSubmitRetry).toMatchObject({
      retryDelayMs: 2500,
      maxRetries: 3,
    });
  });

  it('retries only the submit key after the retry delay when input remains visible', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(2499);
    expect(writes).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(writes).toEqual(['\r']);
  });

  it('does not retry when the input is no longer visible', () => {
    const writes: string[] = [];
    let visible = true;
    const watcher = createWatcher(() => visible, writes);

    watcher.track('hello', '\r');
    visible = false;
    jest.advanceTimersByTime(2500);

    expect(writes).toEqual([]);
  });

  it('resets the idle window when output activity occurs', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(2000);
    watcher.observeOutput('agent progress');
    jest.advanceTimersByTime(1000);
    expect(writes).toEqual([]);

    jest.advanceTimersByTime(1500);
    expect(writes).toEqual(['\r']);
  });

  it('caps submit retries and never retypes the original input', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual(['\r', '\r', '\r']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports retry and exhaustion without writing the original text again', () => {
    const writes: string[] = [];
    const onRetry = jest.fn();
    const onExhausted = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 2500,
      maxRetries: 1,
      write: () => (data) => writes.push(data),
      isInputVisible: () => true,
      onRetry,
      onExhausted,
    });

    watcher.track('hello', '\r', 'delivery-1');
    jest.advanceTimersByTime(2500);
    jest.advanceTimersByTime(2500);

    expect(writes).toEqual(['\r']);
    expect(onRetry).toHaveBeenCalledWith('delivery-1');
    expect(onExhausted).toHaveBeenCalledWith('delivery-1');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports acknowledgement when the input disappears', () => {
    let visible = true;
    const onAcknowledged = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 2500,
      maxRetries: 3,
      write: () => () => undefined,
      isInputVisible: () => visible,
      onAcknowledged,
    });

    watcher.track('hello', '\r', 'delivery-1');
    visible = false;
    jest.advanceTimersByTime(2500);

    expect(onAcknowledged).toHaveBeenCalledWith('delivery-1');
  });

  it('cleans pending retry on disposal', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    watcher.dispose();
    jest.advanceTimersByTime(2500);

    expect(writes).toEqual([]);
  });
});
