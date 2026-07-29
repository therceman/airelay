export const MODEL_CAPACITY_MESSAGE =
  'Selected model is at capacity. Please try a different model.';

export interface CapacityWatcherOptions {
  continuationText: string;
  submitValue: string;
  quietPeriodMs: number;
  submitDelayMs: number;
  write: () => ((data: string) => void) | null;
  capacityMessage?: string;
}

const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

function normalizeOutput(chunk: string): string {
  return chunk.replace(ANSI_SEQUENCE, '').replace(/\r/g, '\n');
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

  constructor(options: CapacityWatcherOptions) {
    this.options = options;
  }

  observe(chunk: string): void {
    if (this.disposed) return;

    this.outputBuffer = `${this.outputBuffer}${chunk}`.slice(-4096);
    const lastLine = getLastMeaningfulLine(this.outputBuffer);
    const capacityMessage = this.options.capacityMessage || MODEL_CAPACITY_MESSAGE;
    if (lastLine !== capacityMessage) {
      this.capacityVisible = false;
      this.clearPendingTimer();
      return;
    }

    if (this.capacityVisible || this.pendingTimer || this.submitTimer) return;
    this.capacityVisible = true;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.sendContinuation();
    }, this.options.quietPeriodMs);
  }

  dispose(): void {
    this.disposed = true;
    this.clearPendingTimer();
    if (this.submitTimer) {
      clearTimeout(this.submitTimer);
      this.submitTimer = null;
    }
  }

  private sendContinuation(): void {
    if (this.disposed) return;
    const write = this.options.write();
    if (!write) {
      this.capacityVisible = false;
      return;
    }

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
