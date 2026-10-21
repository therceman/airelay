import { ACTIVITY_QUIET_MS, ActivityTracker } from '../src/runtime/activity';

describe('ActivityTracker', () => {
  it('uses the five-second quiet boundary for output and input', () => {
    const output = new ActivityTracker();
    output.noteOutput(0);
    expect(output.snapshot({ now: ACTIVITY_QUIET_MS - 1 })).toMatchObject({
      state: 'busy',
      activityReason: 'recent_io',
      quietForMs: ACTIVITY_QUIET_MS - 1,
    });
    expect(output.snapshot({ now: ACTIVITY_QUIET_MS }).state).toBe('idle');

    const input = new ActivityTracker();
    input.noteInput(100);
    expect(input.snapshot({ now: 100 + ACTIVITY_QUIET_MS - 1 }).state).toBe('busy');
    expect(input.snapshot({ now: 100 + ACTIVITY_QUIET_MS }).state).toBe('idle');
  });

  it('resets the quiet clock on repeated activity', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(0);
    tracker.noteOutput(4000);

    expect(tracker.snapshot({ now: 8999 })).toMatchObject({
      state: 'busy',
      activityReason: 'recent_io',
    });
    expect(tracker.snapshot({ now: 9000 }).state).toBe('idle');
  });

  it('tracks raw/manual input independently from output', () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(100);
    tracker.noteOutput(200);

    expect(tracker.snapshot({ now: 201 })).toMatchObject({
      activityReason: 'recent_io',
      lastInputAt: 100,
      lastOutputAt: 200,
      lastActivityAt: 200,
    });
    expect(tracker.snapshot({ now: 5200 }).state).toBe('idle');
  });

  it('reports direct user input separately and expires it after the shared quiet boundary', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(0);
    tracker.noteUserInput(1000);

    expect(tracker.snapshot({ now: 5999 })).toMatchObject({
      state: 'idle',
      userInputState: 'in_progress',
      lastUserInputAt: 1000,
      userInputQuietForMs: 4999,
    });
    expect(tracker.snapshot({ now: 6000 })).toMatchObject({
      state: 'idle',
      userInputState: 'idle',
      lastUserInputAt: 1000,
      userInputQuietForMs: 5000,
    });
  });

  it('keeps a pending prompt busy beyond the quiet interval', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(0);

    expect(tracker.snapshot({ now: 20_000, promptDeliveryPending: true })).toMatchObject({
      state: 'busy',
      activityReason: 'prompt_delivery',
      quietForMs: 20_000,
    });
    expect(tracker.snapshot({ now: 20_000 }).state).toBe('idle');
  });

  it('releases the prompt lease immediately after early acknowledgement or failure', () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(0);

    expect(tracker.snapshot({ now: 10_000, promptDeliveryPending: true }).state).toBe('busy');
    expect(tracker.snapshot({ now: 10_000, promptDeliveryPending: false }).state).toBe('idle');
  });

  it('uses the working hint only as a lower-priority safety guard', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(0);

    expect(tracker.snapshot({ now: 10_000, harnessWorking: true })).toMatchObject({
      state: 'busy',
      activityReason: 'harness_working',
    });
    expect(tracker.snapshot({ now: 10_000 })).toMatchObject({
      state: 'idle',
      activityReason: 'idle',
    });
  });

  it('has canonical reason precedence', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(9000);

    expect(
      tracker.snapshot({
        now: 9000,
        promptDeliveryPending: true,
        harnessWorking: true,
      }).activityReason
    ).toBe('prompt_delivery');
    expect(tracker.snapshot({ now: 9000, harnessWorking: true }).activityReason).toBe(
      'harness_working'
    );
    expect(tracker.snapshot({ now: 9000 }).activityReason).toBe('recent_io');
    expect(tracker.snapshot({ now: 20_000 }).activityReason).toBe('idle');
  });

  it('does not need an active turn generation to report idle', () => {
    const tracker = new ActivityTracker();
    tracker.noteOutput(0);

    // A caller may still retain delivery/turn bookkeeping here; activity is
    // intentionally determined only by the tracker inputs and current guards.
    expect(tracker.snapshot({ now: ACTIVITY_QUIET_MS + 1 })).toEqual({
      state: 'idle',
      activityReason: 'idle',
      userInputState: 'idle',
      lastUserInputAt: null,
      userInputQuietForMs: null,
      lastInputAt: null,
      lastOutputAt: 0,
      lastActivityAt: 0,
      quietForMs: ACTIVITY_QUIET_MS + 1,
    });
  });

  it('reports clean diagnostics before any PTY activity', () => {
    expect(new ActivityTracker().snapshot({ now: 123 })).toEqual({
      state: 'idle',
      activityReason: 'idle',
      userInputState: 'idle',
      lastUserInputAt: null,
      userInputQuietForMs: null,
      lastInputAt: null,
      lastOutputAt: null,
      lastActivityAt: null,
      quietForMs: null,
    });
  });
});
