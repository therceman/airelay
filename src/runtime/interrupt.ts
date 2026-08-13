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
}

export interface InterruptControllerOptions {
  value?: string;
  ackTimeoutMs: number;
  pollIntervalMs: number;
  write: () => ((data: string) => void) | null;
  isActive: () => boolean;
  isWorking: () => boolean;
  onAcknowledged?: () => void;
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

/** Coordinates one bounded PTY interrupt and never destroys the underlying session. */
export class InterruptController {
  private readonly options: InterruptControllerOptions;
  private inFlight: Promise<InterruptResult> | null = null;

  constructor(options: InterruptControllerOptions) {
    this.options = options;
  }

  request(): Promise<InterruptResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.perform().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async perform(): Promise<InterruptResult> {
    if (!this.options.value || !this.options.write()) {
      return { outcome: 'unsupported', requested: false };
    }
    if (!this.options.isActive()) {
      return { outcome: 'no_active_turn', requested: false };
    }
    if (!this.options.isWorking()) {
      return { outcome: 'already_idle', requested: false };
    }

    const startedAt = Date.now();
    try {
      this.options.write()!(this.options.value);
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
      if (!this.options.isWorking()) {
        this.options.onAcknowledged?.();
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
