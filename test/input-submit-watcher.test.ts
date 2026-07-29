import { InputSubmitWatcher } from '../src/runtime/input-submit-watcher';

describe('input submit watcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createWatcher(visible: () => boolean, writes: string[]): InputSubmitWatcher {
    return new InputSubmitWatcher({
      retryDelayMs: 10000,
      maxRetries: 3,
      write: () => (data) => writes.push(data),
      isInputVisible: visible,
    });
  }

  it('retries only the submit key after 10 seconds when input remains visible', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(9999);
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
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual([]);
  });

  it('resets the idle window when output activity occurs', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(9000);
    watcher.observeOutput('agent progress');
    jest.advanceTimersByTime(2000);
    expect(writes).toEqual([]);

    jest.advanceTimersByTime(8000);
    expect(writes).toEqual(['\r']);
  });

  it('caps submit retries and never retypes the original input', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(40000);

    expect(writes).toEqual(['\r', '\r', '\r']);
  });

  it('cleans pending retry on disposal', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    watcher.dispose();
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual([]);
  });
});
