import {
  classifyDeliveryMarker,
  DeliveryMarkerTracker,
  formatTerminalMarker,
} from '../src/runtime/delivery-marker';
import { writeCommandInput } from '../src/runtime/delivery-sequence';
import { InputSubmitWatcher } from '../src/runtime/input-submit-watcher';
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

  it('classifies a collapsed paste marker in the active editor', () => {
    const line = `› [Pasted Content 2278 chars] ${marker}`;
    expect(classifyDeliveryMarker(viewport([line], 0, line.length), marker)).toBe('editor');
  });

  it('requires the marker to be before the cursor on the current row', () => {
    const line = `› [Pasted Content 2278 chars] ${marker}`;
    const markerStart = line.lastIndexOf(marker);

    expect(classifyDeliveryMarker(viewport([line], 0, markerStart), marker)).toBe('absent');
    expect(classifyDeliveryMarker(viewport([`old ${marker} output`], 0, 3), marker)).toBe('absent');
    expect(classifyDeliveryMarker(viewport([`${marker} text`], 0, marker.length + 2), marker)).toBe(
      'absent'
    );
  });

  it('classifies a wrapped marker ending before a cursor at the next row', () => {
    const line = `› wrapped ${marker}`;
    expect(classifyDeliveryMarker(viewport([line, ''], 1, 0), marker)).toBe('editor');
  });

  it('classifies a marker above the active editor as committed', () => {
    expect(
      classifyDeliveryMarker(viewport([`• committed ${marker}`, '› Ask Codex'], 1), marker)
    ).toBe('committed');
  });

  it('does not search outside the bounded current cursor window', () => {
    const lines = Array.from({ length: 20 }, (_, index) => (index === 0 ? marker : ''));
    expect(classifyDeliveryMarker(viewport(lines, 19), marker)).toBe('absent');
  });

  it('keeps hidden and returned redraws pending', () => {
    const tracker = new DeliveryMarkerTracker();
    tracker.observe('editor');
    expect(tracker.getPhase()).toBe('pending_visible');
    tracker.observe('absent');
    expect(tracker.getPhase()).toBe('transient_hidden');
    tracker.observe('editor');
    expect(tracker.getPhase()).toBe('pending_returned');
    expect(tracker.isAcknowledged()).toBe(false);
    expect(tracker.isInEditor()).toBe(true);
    tracker.observe('absent');
    expect(tracker.isAcknowledged()).toBe(false);
  });

  it('handles the resume redraw regression without rewriting the body', async () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    const tracker = new DeliveryMarkerTracker();
    let observation: 'editor' | 'committed' | 'absent' = 'editor';

    await writeCommandInput({
      body: '[Pasted Content 2278 chars]',
      marker,
      submit: '\r',
      totalDelayMs: 0,
      write: (value) => writes.push(value),
      delay: async () => undefined,
    });
    tracker.observe('editor');

    const watcher = new InputSubmitWatcher({
      retryDelayMs: 10,
      maxRetries: 3,
      maxWindowMs: 100,
      write: () => (value) => writes.push(value),
      isInputVisible: () => observation === 'editor',
      isSubmissionAcknowledged: () => tracker.isAcknowledged(),
    });
    watcher.track(marker, '\r');

    jest.advanceTimersByTime(5);
    observation = 'absent';
    tracker.observe('absent');
    watcher.observeOutput('resume redraw');
    jest.advanceTimersByTime(5);

    observation = 'editor';
    tracker.observe('editor');
    jest.advanceTimersByTime(10);
    expect(writes.filter((value) => value === '\r')).toHaveLength(2);
    expect(tracker.isAcknowledged()).toBe(false);

    observation = 'absent';
    tracker.observe('absent');
    watcher.observeOutput('second redraw');
    expect(tracker.isAcknowledged()).toBe(false);
    watcher.dispose();

    expect(writes.filter((value) => value === '[Pasted Content 2278 chars]')).toHaveLength(1);
    expect(writes.filter((value) => value === ` ${marker}`)).toHaveLength(1);
  });

  it('does not acknowledge disappearance without committed or verified working evidence', () => {
    const tracker = new DeliveryMarkerTracker();
    tracker.observe('editor');
    tracker.observe('absent');
    expect(tracker.isAcknowledged()).toBe(false);
  });

  it('acknowledges a committed marker exactly once', () => {
    const tracker = new DeliveryMarkerTracker();
    tracker.observe('editor');
    expect(tracker.observe('committed')).toBe('acknowledged');
    expect(tracker.observe('absent')).toBe('acknowledged');
    expect(tracker.isAcknowledged()).toBe(true);
  });

  it('accepts a positively committed marker even if the editor frame was coalesced', () => {
    const tracker = new DeliveryMarkerTracker();

    expect(tracker.observe('committed')).toBe('acknowledged');
    expect(tracker.isAcknowledged()).toBe(true);
  });

  it('allows working fallback only before a redraw-return cycle', () => {
    const direct = new DeliveryMarkerTracker();
    direct.observe('editor');
    direct.observe('absent');
    expect(direct.canUseWorkingAck()).toBe(true);

    const redraw = new DeliveryMarkerTracker();
    redraw.observe('editor');
    redraw.observe('absent');
    redraw.observe('editor');
    redraw.observe('absent');
    expect(redraw.canUseWorkingAck()).toBe(false);
  });

  it('does not allow a working hint to acknowledge a returned redraw', () => {
    const tracker = new DeliveryMarkerTracker();
    tracker.observe('editor');
    tracker.observe('absent');
    tracker.observe('editor');
    tracker.observe('absent');

    expect(tracker.isAcknowledged()).toBe(false);
    expect(tracker.canUseWorkingAck()).toBe(false);
  });

  it('classifies the current xterm frame after the current chunk is flushed', async () => {
    const controller = new SessionController(`delivery_marker_render_${process.pid}`);
    await controller.start();

    const line = `› [Pasted Content 2278 chars] ${marker}`;
    controller.feedOutput(line);
    expect(classifyDeliveryMarker(controller.getLiveViewportState(), marker)).toBe('absent');

    await controller.flushViewport();
    expect(classifyDeliveryMarker(controller.getLiveViewportState(), marker)).toBe('editor');

    await controller.stop();
  });

  it('tracks resume redraw through the rendered controller and retries Enter only once', async () => {
    const controller = new SessionController(`delivery_marker_resume_${process.pid}_${Date.now()}`);
    await controller.start();
    const writes: string[] = ['body'];
    const tracker = new DeliveryMarkerTracker();
    const acknowledged = jest.fn();
    const watcher = new InputSubmitWatcher({
      retryDelayMs: 30,
      maxRetries: 3,
      maxWindowMs: 200,
      write: () => (value) => writes.push(value),
      isInputVisible: (activeMarker) =>
        classifyDeliveryMarker(controller.getLiveViewportState(), activeMarker) === 'editor',
      isSubmissionAcknowledged: () => tracker.isAcknowledged(),
      onAcknowledged: acknowledged,
    });

    const feed = async (output: string): Promise<void> => {
      controller.feedOutput(output);
      await controller.flushViewport();
    };

    const editorLine = `› [Pasted Content 2278 chars] ${marker}`;
    await feed(editorLine);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    watcher.track(marker, '\r', 'resume-redraw');

    await feed('\x1b[2J\x1b[H');
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    await feed(editorLine);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(writes).toEqual(['body', '\r']);
    expect(tracker.isAcknowledged()).toBe(false);
    expect(acknowledged).not.toHaveBeenCalled();

    await feed(`\x1b[2J\x1b[H• committed ${marker}\r\n› `);
    tracker.observe(classifyDeliveryMarker(controller.getLiveViewportState(), marker));
    watcher.observeOutput('committed marker');

    expect(writes).toEqual(['body', '\r']);
    expect(tracker.isAcknowledged()).toBe(true);
    expect(acknowledged).toHaveBeenCalledWith('resume-redraw');
    watcher.dispose();
    await controller.stop();
  });
});
