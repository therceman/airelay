import { InputSubmitWatcher, isInputTextVisible } from '../src/runtime/input-submit-watcher';
import { getHarnessCapabilities, getHarnessSelfUpdateOverrides } from '../src/utils/harness';

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

  it('declares the bounded retry timing for codex', () => {
    expect(getHarnessCapabilities('codex').inputSubmitRetry).toMatchObject({
      retryDelayMs: 2500,
      maxRetries: 3,
      maxWindowMs: 10000,
      pendingInputMarkers: ['[Pasted Content ', '[Paste '],
    });
  });

  it('declares provider-specific self-update suppression', () => {
    expect(getHarnessCapabilities('codex').selfUpdateDisabled).toEqual({
      args: ['-c', 'check_for_update_on_startup=false'],
    });
    expect(getHarnessCapabilities('opencode').selfUpdateDisabled).toEqual({
      env: { OPENCODE_DISABLE_AUTOUPDATE: 'true' },
    });
    expect(getHarnessSelfUpdateOverrides('codex', false)).toEqual({
      args: ['-c', 'check_for_update_on_startup=false'],
      env: {},
    });
    expect(getHarnessSelfUpdateOverrides('opencode', true)).toEqual({ args: [], env: {} });
  });

  it('never extends the retry window when output keeps arriving', () => {
    const writes: string[] = [];
    const onExhausted = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 100,
      maxRetries: 10,
      maxWindowMs: 500,
      write: () => (data) => writes.push(data),
      isInputVisible: () => true,
      onExhausted,
    });

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(100);
    watcher.observeOutput('progress');
    jest.advanceTimersByTime(100);
    watcher.observeOutput('progress');
    jest.advanceTimersByTime(100);
    watcher.observeOutput('progress');
    jest.advanceTimersByTime(200);

    expect(writes).toHaveLength(4);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
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

  it('does not extend the retry deadline for unrelated output activity', () => {
    const writes: string[] = [];
    const watcher = createWatcher(() => true, writes);

    watcher.track('hello', '\r');
    jest.advanceTimersByTime(2000);
    watcher.observeOutput('agent progress');
    jest.advanceTimersByTime(500);
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
    let acknowledged = false;
    const onAcknowledged = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 2500,
      maxRetries: 3,
      write: () => () => undefined,
      isInputVisible: () => false,
      isSubmissionAcknowledged: () => acknowledged,
      onAcknowledged,
    });

    watcher.track('hello', '\r', 'delivery-1');
    acknowledged = true;
    jest.advanceTimersByTime(2500);

    expect(onAcknowledged).toHaveBeenCalledWith('delivery-1');
  });

  it('does not treat missing input text as a successful submission', () => {
    const onAcknowledged = jest.fn();
    const onExhausted = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 100,
      maxRetries: 1,
      maxWindowMs: 200,
      write: () => () => undefined,
      isInputVisible: () => false,
      isSubmissionAcknowledged: () => false,
      onAcknowledged,
      onExhausted,
    });

    watcher.track('hello', '\r', 'delivery-1');
    jest.advanceTimersByTime(200);

    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(onExhausted).toHaveBeenCalledWith('delivery-1');
  });

  it('matches a long prompt through a visible terminal anchor', () => {
    const text = 'x'.repeat(160) + ' final prompt text';
    expect(isInputTextVisible(text, [`› [Pasted Content 176 chars] ${text.slice(-64)}`])).toBe(
      true
    );
    expect(isInputTextVisible(text, ['previous output only'])).toBe(false);
  });

  it('matches the minimum 16-character prompt anchor', () => {
    expect(isInputTextVisible('[SP-GTW-120E] go with more text', ['› [SP-GTW-120E] go'])).toBe(
      true
    );
    expect(isInputTextVisible('[SP-GTW-120E] go more', ['› [SP-GTW-120E]'])).toBe(false);
  });

  it('matches a short prompt represented by a harness-owned paste placeholder', () => {
    expect(isInputTextVisible('olo', ['› [Pasted Content 3 chars]'], ['[Pasted Content '])).toBe(
      true
    );
    expect(isInputTextVisible('olo', ['agent output [Pasted Content 3 chars]'])).toBe(false);
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
