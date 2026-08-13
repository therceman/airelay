import {
  CapacityContinuationWatcher,
  getLastMeaningfulLine,
  MODEL_CAPACITY_MESSAGE,
} from '../src/runtime/capacity-watcher';

describe('capacity continuation watcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recognizes the exact final message after ANSI normalization', () => {
    expect(getLastMeaningfulLine(`\u001b[31m${MODEL_CAPACITY_MESSAGE}\u001b[0m\r\n`)).toBe(
      MODEL_CAPACITY_MESSAGE
    );
    expect(getLastMeaningfulLine('progress\nother output')).toBe('other output');
  });

  it('recognizes a capacity message split across PTY output chunks', () => {
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 10000,
      submitDelayMs: 2000,
      write: () => (data) => writes.push(data),
    });

    watcher.observe('Selected model is at capacity. Please try a ');
    watcher.observe('different model.');
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual(['continue']);
  });

  it('recognizes the warning-prefixed capacity message emitted by Codex', () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 10000,
      submitDelayMs: 2000,
      write: () => (data: string) => writes.push(data),
    });

    watcher.observe('⚠ Selected model is at capacity. Please try a different model.\r\n');
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual(['continue']);
    watcher.dispose();
    jest.useRealTimers();
  });

  it('ignores Codex OSC redraw sequences after the capacity message', () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 10000,
      submitDelayMs: 2000,
      write: () => (data: string) => writes.push(data),
    });

    watcher.observe(
      '\u001b[38;5;3m⚠ Selected model is at capacity. Please try a different model.\u001b[39m\n' +
        '\u001b]10;?\u001b\\\n\u001b]11;?\u001b\\\n\u001b[?25h'
    );
    jest.advanceTimersByTime(10000);

    expect(writes).toEqual(['continue']);
    watcher.dispose();
    jest.useRealTimers();
  });

  it('sends continue once after quiet time and then submits it', () => {
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 1500,
      submitDelayMs: 2000,
      write: () => (data) => writes.push(data),
    });

    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    jest.advanceTimersByTime(1499);
    expect(writes).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(writes).toEqual(['continue']);

    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    jest.advanceTimersByTime(2000);
    expect(writes).toEqual(['continue', '\r']);
  });

  it('cancels a pending continuation when the final output changes', () => {
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 1500,
      submitDelayMs: 2000,
      write: () => (data) => writes.push(data),
    });

    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    watcher.observe('agent is working');
    jest.advanceTimersByTime(3500);
    expect(writes).toEqual([]);
  });

  it('does not classify arbitrary agent text containing the capacity phrase as capacity', () => {
    const writes: string[] = [];
    const onDetected = jest.fn();
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 1500,
      submitDelayMs: 2000,
      write: () => (data) => writes.push(data),
      onDetected,
    });

    watcher.observe(`The agent quoted: ${MODEL_CAPACITY_MESSAGE}\n`);
    jest.advanceTimersByTime(5000);

    expect(writes).toEqual([]);
    expect(onDetected).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it('does not send after disposal', () => {
    const writes: string[] = [];
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 1500,
      submitDelayMs: 2000,
      write: () => (data) => writes.push(data),
    });

    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    watcher.dispose();
    jest.advanceTimersByTime(4000);
    expect(writes).toEqual([]);
  });

  it('bounds continuation attempts and reports exhaustion', () => {
    const writes: string[] = [];
    const onDetected = jest.fn();
    const onContinuation = jest.fn();
    const onExhausted = jest.fn();
    const watcher = new CapacityContinuationWatcher({
      continuationText: 'continue',
      submitValue: '\r',
      quietPeriodMs: 10,
      submitDelayMs: 0,
      retryDelaysMs: [10, 10],
      maxAttempts: 2,
      write: () => (data) => writes.push(data),
      onDetected,
      onContinuation,
      onExhausted,
    });

    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    jest.advanceTimersByTime(10);
    jest.advanceTimersByTime(1);
    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);
    jest.advanceTimersByTime(10);
    jest.advanceTimersByTime(1);
    watcher.observe(`${MODEL_CAPACITY_MESSAGE}\n`);

    expect(writes).toEqual(['continue', '\r', 'continue', '\r']);
    expect(onDetected).toHaveBeenCalledTimes(2);
    expect(onContinuation).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
