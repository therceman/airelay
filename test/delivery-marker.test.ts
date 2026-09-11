import {
  classifyDeliveryMarker,
  DeliveryMarkerTracker,
  formatTerminalMarker,
  isInputPromptMarkerVisible,
} from '../src/runtime/delivery-marker';
import { writeCommandInput } from '../src/runtime/delivery-sequence';
import { InputSubmitWatcher } from '../src/runtime/input-submit-watcher';
import { PostSubmitWorkingDetector } from '../src/runtime/post-submit-working';
import { SessionController } from '../src/controller';
import { useTestEnv } from './test-utils';

const marker = '[12:33:12]';
useTestEnv();

function viewport(lines: string[], cursorRow: number, cursorColumn = 0) {
  return { lines, cursorRow, cursorColumn };
}

describe('delivery marker state machine', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('formats local time with zero padding', () => {
    expect(formatTerminalMarker(new Date(2026, 0, 2, 1, 2, 3))).toBe('[01:02:03]');
    expect(formatTerminalMarker(new Date(2026, 0, 2, 12, 3, 7))).toBe('[12:03:07]');
  });

  it('reports a collapsed paste marker as visible without inferring editor ownership', () => {
    const line = `› [Pasted Content 2278 chars] ${marker}`;
    expect(classifyDeliveryMarker(viewport([line, 'footer'], 1, 0), marker)).toBe('visible');
  });

  it('reports a marker above a later cursor as visible, not committed', () => {
    expect(
      classifyDeliveryMarker(
        viewport(
          [
            `› [Pasted Content 1024 chars][Pasted Content 1024 chars]`,
            `STOP for Planner review. ${marker}`,
            '› Ask Codex',
          ],
          2,
          4
        ),
        marker
      )
    ).toBe('visible');
  });

  it('recognizes Devin collapsed paste input without requiring the timestamp suffix', () => {
    expect(
      isInputPromptMarkerVisible(viewport(['❭ [Pasted text #1 +14 lines]', 'footer'], 0, 28), '❭')
    ).toBe(true);
    expect(isInputPromptMarkerVisible(viewport(['old ❭ output'], 0, 0), '❭')).toBe(false);
  });

  it('retries Enter for Devin collapsed paste input without rewriting the body', () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    const devinViewport = viewport(['❭ [Pasted text #1 +14 lines]'], 0, 28);
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 2500,
      maxRetries: 3,
      maxWindowMs: 10000,
      write: () => (value) => writes.push(value),
      isInputVisible: () => isInputPromptMarkerVisible(devinViewport, '❭'),
    });

    watcher.track('[12:33:12]', '\r', 'devin-delivery');
    jest.advanceTimersByTime(2500);

    expect(writes).toEqual(['\r']);
    watcher.dispose();
  });

  it('does not search outside the bounded current cursor window', () => {
    const lines = Array.from({ length: 20 }, (_, index) => (index === 0 ? marker : ''));
    expect(classifyDeliveryMarker(viewport(lines, 19), marker)).toBe('absent');
  });

  it('never acknowledges marker visibility or redraw transitions', () => {
    const tracker = new DeliveryMarkerTracker();
    expect(tracker.observe('visible')).toBe('pending_visible');
    expect(tracker.observe('absent')).toBe('transient_hidden');
    expect(tracker.observe('visible')).toBe('pending_returned');
    expect(tracker.isAcknowledged()).toBe(false);
    expect(tracker.isVisible()).toBe(true);
    expect(tracker.canUseWorkingAck()).toBe(false);
    expect(tracker.markAcknowledged()).toBe('acknowledged');
    expect(tracker.isAcknowledged()).toBe(true);
  });

  it('accepts a fresh working hint only after resetting the submit-attempt detector', () => {
    const detector = new PostSubmitWorkingDetector('esc to interrupt');
    detector.observe('old esc to interrupt from before submit');
    detector.reset();
    expect(detector.hasDetected()).toBe(false);
    expect(detector.observe('esc to int')).toBe(false);
    expect(detector.observe('errupt')).toBe(true);
  });

  it('writes body, marker and submit as separate ordered operations', async () => {
    const writes: string[] = [];
    await writeCommandInput({
      body: 'exact body',
      marker,
      submit: '\r',
      totalDelayMs: 0,
      write: (value) => writes.push(value),
      delay: async () => undefined,
    });
    expect(writes).toEqual(['exact body', ` ${marker}`, '\r']);
  });

  it('keeps multiline resume redraw pending and acknowledges only fresh working output', async () => {
    const controller = new SessionController(`delivery_marker_resume_${process.pid}_${Date.now()}`);
    await controller.start();
    const writes = ['body', ` ${marker}`];
    const tracker = new DeliveryMarkerTracker();
    const working = new PostSubmitWorkingDetector('esc to interrupt');
    const acknowledged = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 30,
      maxRetries: 3,
      maxWindowMs: 200,
      write: () => (value) => writes.push(value),
      isInputVisible: (activeMarker) =>
        classifyDeliveryMarker(controller.getLiveViewportState(), activeMarker) === 'visible',
      isSubmissionAcknowledged: () => tracker.isAcknowledged(),
      onAcknowledged: acknowledged,
      onRetry: () => {
        tracker.reset();
        working.reset();
      },
    });

    const feed = async (output: string): Promise<void> => {
      controller.feedOutput(output);
      await controller.flushViewport();
    };
    const pendingInput =
      '› [Pasted Content 1024 chars][Pasted Content 1024 chars]\r\n' +
      `STOP for Planner review. ${marker}\r\n› `;

    await feed(pendingInput);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    watcher.track(marker, '\r', 'resume-redraw');

    await feed('\x1b[2J\x1b[H');
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    await feed(pendingInput);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(writes).toEqual(['body', ` ${marker}`, '\r']);
    expect(tracker.isAcknowledged()).toBe(false);
    expect(acknowledged).not.toHaveBeenCalled();

    await feed(pendingInput);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    const freshOutput = 'esc to interrupt';
    expect(working.observe(freshOutput)).toBe(true);
    if (tracker.canUseWorkingAck()) tracker.markAcknowledged();
    watcher.observeOutput(freshOutput);

    expect(writes).toEqual(['body', ` ${marker}`, '\r']);
    expect(tracker.isAcknowledged()).toBe(true);
    expect(acknowledged).toHaveBeenCalledWith('resume-redraw');
    expect(writes.filter((value) => value === 'body')).toHaveLength(1);
    expect(writes.filter((value) => value === ` ${marker}`)).toHaveLength(1);
    watcher.dispose();
    await controller.stop();
  });
});
