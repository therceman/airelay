export interface InputSubmitWatcherOptions {
  retryDelayMs: number;
  maxRetries: number;
  maxWindowMs?: number;
  write: () => ((data: string) => void) | null;
  isInputVisible: (text: string) => boolean;
  isSubmissionAcknowledged?: () => boolean;
  onAcknowledged?: (deliveryId?: string) => void;
  onRetry?: (deliveryId?: string) => void;
  onExhausted?: (deliveryId?: string) => void;
}

interface PendingInput {
  text: string;
  submitValue: string;
  deliveryId?: string;
  retries: number;
  retryDeadlineAt?: number;
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
    const startedAt = Date.now();
    this.pending = {
      text,
      submitValue,
      deliveryId,
      retries: 0,
      retryDeadlineAt:
        this.options.maxWindowMs !== undefined
          ? startedAt + Math.max(0, this.options.maxWindowMs)
          : undefined,
    };
    this.lastActivityAt = startedAt;
    this.schedule(this.getNextDelay(this.options.retryDelayMs, this.pending));
  }

  observeOutput(chunk: string): void {
    if (this.disposed || !chunk.trim() || !this.pending) return;
    if (this.options.isSubmissionAcknowledged?.()) {
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

  cancel(): void {
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

    const now = Date.now();
    if (pending.retryDeadlineAt !== undefined && now >= pending.retryDeadlineAt) {
      this.pending = null;
      this.options.onExhausted?.(pending.deliveryId);
      return;
    }

    const elapsed = now - this.lastActivityAt;
    if (elapsed < this.options.retryDelayMs) {
      this.schedule(this.getNextDelay(this.options.retryDelayMs - elapsed, pending));
      return;
    }

    if (this.options.isSubmissionAcknowledged?.()) {
      this.pending = null;
      this.options.onAcknowledged?.(pending.deliveryId);
      return;
    }

    if (!this.options.isInputVisible(pending.text)) {
      if (pending.retryDeadlineAt === undefined) {
        this.pending = null;
        this.options.onExhausted?.(pending.deliveryId);
        return;
      }

      this.schedule(this.getNextDelay(this.options.retryDelayMs, pending));
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
    this.schedule(this.getNextDelay(this.options.retryDelayMs, pending));
  }

  private getNextDelay(delayMs: number, pending: PendingInput): number {
    if (pending.retryDeadlineAt === undefined) {
      return delayMs;
    }

    return Math.min(delayMs, Math.max(0, pending.retryDeadlineAt - Date.now()));
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Match terminal-wrapped input without requiring the whole prompt in one viewport. */
export function isInputTextVisible(text: string, viewportLines: string[]): boolean {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const viewport = viewportLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!normalizedText || !viewport || viewport.includes(normalizedText)) return !!normalizedText;

  const anchorLength = 64;
  const anchors = [normalizedText.slice(0, anchorLength), normalizedText.slice(-anchorLength)];
  return anchors.some((anchor) => anchor.length >= 24 && viewport.includes(anchor));
}
