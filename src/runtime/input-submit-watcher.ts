export interface InputSubmitWatcherOptions {
  retryDelayMs: number;
  maxRetries: number;
  write: () => ((data: string) => void) | null;
  isInputVisible: (text: string) => boolean;
  onAcknowledged?: (deliveryId?: string) => void;
  onRetry?: (deliveryId?: string) => void;
  onExhausted?: (deliveryId?: string) => void;
}

interface PendingInput {
  text: string;
  submitValue: string;
  deliveryId?: string;
  retries: number;
}

/** Retries only the submit key when text remains visible but the app is idle. */
export class InputSubmitWatcher {
  private readonly options: InputSubmitWatcherOptions;
  private pending: PendingInput | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = 0;
  private disposed = false;

  constructor(options: InputSubmitWatcherOptions) {
    this.options = options;
  }

  track(text: string, submitValue: string, deliveryId?: string): void {
    if (this.disposed || !text.trim()) return;
    this.pending = { text, submitValue, deliveryId, retries: 0 };
    this.lastActivityAt = Date.now();
    this.schedule(this.options.retryDelayMs);
  }

  observeOutput(chunk: string): void {
    if (this.disposed || !chunk.trim() || !this.pending) return;
    this.lastActivityAt = Date.now();
    if (!this.options.isInputVisible(this.pending.text)) {
      const deliveryId = this.pending.deliveryId;
      this.pending = null;
      this.clearTimer();
      this.options.onAcknowledged?.(deliveryId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.clearTimer();
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.check(), Math.max(0, delayMs));
  }

  private check(): void {
    this.timer = null;
    const pending = this.pending;
    if (this.disposed || !pending) return;

    const elapsed = Date.now() - this.lastActivityAt;
    if (elapsed < this.options.retryDelayMs) {
      this.schedule(this.options.retryDelayMs - elapsed);
      return;
    }

    if (!this.options.isInputVisible(pending.text)) {
      this.pending = null;
      this.options.onAcknowledged?.(pending.deliveryId);
      return;
    }

    if (pending.retries >= this.options.maxRetries) {
      this.pending = null;
      this.options.onExhausted?.(pending.deliveryId);
      return;
    }

    const write = this.options.write();
    if (!write) {
      this.pending = null;
      return;
    }

    write(pending.submitValue);
    pending.retries += 1;
    this.options.onRetry?.(pending.deliveryId);
    this.lastActivityAt = Date.now();
    this.schedule(this.options.retryDelayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
