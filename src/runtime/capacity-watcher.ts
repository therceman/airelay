export const MODEL_CAPACITY_MESSAGE =
  'Selected model is at capacity. Please try a different model.';

export interface CapacityWatcherOptions {
  continuationText: string;
  submitValue: string;
  quietPeriodMs: number;
  submitDelayMs: number;
  write: () => ((data: string) => void) | null;
  capacityMessage?: string;
  maxAttempts?: number;
  retryDelaysMs?: number[];
  onDetected?: (attempt: number) => void;
  onContinuation?: (attempt: number) => void;
  onExhausted?: () => void;
}

const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const OSC_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\][^${String.fromCharCode(7)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)`,
  'g'
);

function normalizeOutput(chunk: string): string {
  return chunk.replace(ANSI_SEQUENCE, '').replace(OSC_SEQUENCE, '').replace(/\r/g, '\n');
}

function normalizeCapacityLine(line: string): string {
  return line.replace(/^(?:\u26a0|\uFE0F)\s*/, '').trim();
}

export function getLastMeaningfulLine(chunk: string): string {
  const lines = normalizeOutput(chunk)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) || '';
}

/** Sends one continuation for each new exact capacity interruption. */
export class CapacityContinuationWatcher {
  private readonly options: CapacityWatcherOptions;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private submitTimer: ReturnType<typeof setTimeout> | null = null;
  private capacityVisible = false;
  private disposed = false;
  private outputBuffer = '';
  private attempts = 0;
  private exhausted = false;

  constructor(options: CapacityWatcherOptions) {
    this.options = options;
  }

  observe(chunk: string): void {
    if (this.disposed) return;

    this.outputBuffer = `${this.outputBuffer}${chunk}`.slice(-4096);
    const lastLine = normalizeCapacityLine(getLastMeaningfulLine(this.outputBuffer));
    const capacityMessage = this.options.capacityMessage || MODEL_CAPACITY_MESSAGE;
    if (lastLine !== capacityMessage) {
      this.capacityVisible = false;
      this.clearPendingTimer();
      if (!this.submitTimer) {
        this.attempts = 0;
        this.exhausted = false;
      }
      return;
    }

    if (this.capacityVisible || this.pendingTimer || this.submitTimer) return;
    const maxAttempts = this.options.maxAttempts ?? 3;
    if (this.attempts >= maxAttempts) {
      if (!this.exhausted) {
        this.exhausted = true;
        this.options.onExhausted?.();
      }
      return;
    }
    this.capacityVisible = true;
    const attempt = this.attempts + 1;
    this.options.onDetected?.(attempt);
    const retryDelays = this.options.retryDelaysMs;
    const delay = retryDelays?.length
      ? retryDelays[Math.min(this.attempts, retryDelays.length - 1)]
      : this.options.quietPeriodMs;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.sendContinuation(attempt);
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    this.clearPendingTimer();
    if (this.submitTimer) {
      clearTimeout(this.submitTimer);
      this.submitTimer = null;
    }
  }

  private sendContinuation(attempt: number): void {
    if (this.disposed) return;
    const write = this.options.write();
    if (!write) {
      this.capacityVisible = false;
      this.exhausted = true;
      this.options.onExhausted?.();
      return;
    }

    this.attempts = attempt;
    this.options.onContinuation?.(attempt);
    write(this.options.continuationText);
    this.capacityVisible = false;
    this.submitTimer = setTimeout(() => {
      this.submitTimer = null;
      if (!this.disposed) {
        const currentWrite = this.options.write();
        if (currentWrite) currentWrite(this.options.submitValue);
      }
    }, this.options.submitDelayMs);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
