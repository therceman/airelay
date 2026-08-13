export type InterruptOutcome =
  | 'interrupt_acknowledged'
  | 'already_idle'
  | 'no_active_turn'
  | 'unsupported'
  | 'timed_out'
  | 'failed';

export interface InterruptResult {
  outcome: InterruptOutcome;
  requested: boolean;
  elapsedMs?: number;
  error?: string;
  reason?: 'turn_changed';
}

export interface InterruptControllerOptions {
  value?: string;
  ackTimeoutMs: number;
  pollIntervalMs: number;
  write: () => ((data: string) => void) | null;
  getActiveTurnId: () => number | undefined;
  isWorking: (turnId: number) => boolean;
  onAcknowledged?: (turnId: number) => void;
}

interface InFlightInterrupt {
  turnId: number;
  promise: Promise<InterruptResult>;
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

/** Coordinates one bounded PTY interrupt and never destroys the underlying session. */
export class InterruptController {
  private readonly options: InterruptControllerOptions;
  private inFlight: InFlightInterrupt | null = null;

  constructor(options: InterruptControllerOptions) {
    this.options = options;
  }

  request(): Promise<InterruptResult> {
    const turnId = this.options.getActiveTurnId();
    const inFlight = this.inFlight;
    if (inFlight !== null && inFlight.turnId === turnId && turnId !== undefined) {
      return inFlight.promise;
    }

    const record = {} as InFlightInterrupt;
    const promise = this.perform(turnId).finally(() => {
      if (this.inFlight === record) {
        this.inFlight = null;
      }
    });
    record.turnId = turnId as number;
    record.promise = promise;
    if (turnId !== undefined) {
      this.inFlight = record;
    }
    return promise;
  }

  private async perform(turnId: number | undefined): Promise<InterruptResult> {
    const write = this.options.write();
    if (!this.options.value || !write) {
      return { outcome: 'unsupported', requested: false };
    }
    if (turnId === undefined || this.options.getActiveTurnId() === undefined) {
      return { outcome: 'no_active_turn', requested: false };
    }
    if (this.options.getActiveTurnId() !== turnId) {
      return { outcome: 'failed', requested: false, reason: 'turn_changed' };
    }
    if (!this.options.isWorking(turnId)) {
      return { outcome: 'already_idle', requested: false };
    }

    // Re-check immediately before the PTY write. No await occurs between this
    // check and the write, so a different turn cannot inherit the request.
    if (this.options.getActiveTurnId() !== turnId) {
      return { outcome: 'failed', requested: false, reason: 'turn_changed' };
    }

    const startedAt = Date.now();
    try {
      write(this.options.value);
    } catch (error) {
      return {
        outcome: 'failed',
        requested: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const deadline = startedAt + Math.max(0, this.options.ackTimeoutMs);
    while (Date.now() <= deadline) {
      if (this.options.getActiveTurnId() !== turnId) {
        return { outcome: 'failed', requested: true, reason: 'turn_changed' };
      }
      if (!this.options.isWorking(turnId)) {
        this.options.onAcknowledged?.(turnId);
        return {
          outcome: 'interrupt_acknowledged',
          requested: true,
          elapsedMs: Date.now() - startedAt,
        };
      }
      await sleep(Math.min(this.options.pollIntervalMs, Math.max(1, deadline - Date.now())));
    }

    return {
      outcome: 'timed_out',
      requested: true,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
