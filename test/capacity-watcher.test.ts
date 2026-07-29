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

    watcher.observe(MODEL_CAPACITY_MESSAGE);
    watcher.observe('agent is working');
    jest.advanceTimersByTime(3500);
    expect(writes).toEqual([]);
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

    watcher.observe(MODEL_CAPACITY_MESSAGE);
    watcher.dispose();
    jest.advanceTimersByTime(4000);
    expect(writes).toEqual([]);
  });
});
