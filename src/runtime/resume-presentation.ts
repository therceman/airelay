import { LIVE_PRESENTATION_RESET, SessionController } from '../controller';

export const RESUME_PRESENTATION_QUIET_MS = 1000;
export const RESUME_PRESENTATION_MAX_MS = 10_000;

export type ResumePresentationRevealReason = 'quiet_period' | 'absolute_max';

export interface PresentationViewport {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
}

export interface PresentationTerminalSize {
  cols: number;
  rows: number;
}

export interface ResumePresentationRevealInfo {
  reason: ResumePresentationRevealReason;
  suppressedBytes: number;
  suppressedChunks: number;
  rows: number;
}

export interface ResumePresentationGateOptions {
  writeForeground: (chunk: string) => void;
  reveal: (
    reason: ResumePresentationRevealReason,
    isCurrent: () => boolean
  ) => Promise<number | null>;
  quietMs?: number;
  maxMs?: number;
  onStarted?: () => void;
  onRevealed?: (info: ResumePresentationRevealInfo) => void;
}

/**
 * Suppresses only direct foreground PTY painting while a resumed TUI hydrates.
 * PTY output still reaches the controller through the normal onOutput path.
 */
export class ResumePresentationGate {
  private readonly quietMs: number;
  private readonly maxMs: number;
  private readonly startedAt = Date.now();
  private lastOutputAt = this.startedAt;
  private generation = 0;
  private suppressedBytes = 0;
  private suppressedChunks = 0;
  private state: 'closed' | 'open' | 'disposed' = 'closed';
  private revealInFlight = false;
  private maxReached = false;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ResumePresentationGateOptions) {
    this.quietMs = Math.max(0, options.quietMs ?? RESUME_PRESENTATION_QUIET_MS);
    this.maxMs = Math.max(this.quietMs, options.maxMs ?? RESUME_PRESENTATION_MAX_MS);
    options.onStarted?.();
    this.scheduleQuietTimer();
    this.maxTimer = setTimeout(() => {
      this.maxReached = true;
      this.beginReveal('absolute_max', this.generation);
    }, this.maxMs);
  }

  write(chunk: string): void {
    if (this.state === 'disposed') return;
    if (this.state === 'open') {
      this.options.writeForeground(chunk);
      return;
    }

    this.suppressedBytes += Buffer.byteLength(chunk, 'utf8');
    this.suppressedChunks += 1;
    this.generation += 1;
    this.lastOutputAt = Date.now();
    this.scheduleQuietTimer();
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.generation += 1;
    this.clearTimers();
  }

  private scheduleQuietTimer(): void {
    if (this.state !== 'closed') return;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      const quietFor = Date.now() - this.lastOutputAt;
      if (quietFor < this.quietMs) {
        this.scheduleQuietTimer();
        return;
      }
      this.beginReveal('quiet_period', this.generation);
    }, this.quietMs);
  }

  private beginReveal(reason: ResumePresentationRevealReason, token: number): void {
    if (this.state !== 'closed' || this.revealInFlight) return;
    if (reason === 'quiet_period' && token !== this.generation) return;
    this.revealInFlight = true;
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }

    void this.options
      .reveal(reason, () => this.state === 'closed' && token === this.generation)
      .then((rows) => {
        const isCurrent = token === this.generation && this.state === 'closed';
        if (rows !== null && (reason === 'absolute_max' || isCurrent)) {
          this.state = 'open';
          this.clearTimers();
          this.options.onRevealed?.({
            reason,
            suppressedBytes: this.suppressedBytes,
            suppressedChunks: this.suppressedChunks,
            rows,
          });
          return;
        }

        this.revealInFlight = false;
        if (this.state !== 'closed') return;
        if (this.maxReached) {
          this.beginReveal('absolute_max', this.generation);
        } else {
          this.scheduleQuietTimer();
        }
      })
      .catch(() => {
        this.revealInFlight = false;
        if (this.state === 'closed') {
          if (this.maxReached) this.beginReveal('absolute_max', this.generation);
          else this.scheduleQuietTimer();
        }
      });
  }

  private clearTimers(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.quietTimer = null;
    this.maxTimer = null;
  }
}

export function serializeResumeViewport(
  viewport: PresentationViewport,
  size: PresentationTerminalSize
): string {
  const rows = Math.max(1, Math.floor(size.rows));
  const cols = Math.max(1, Math.floor(size.cols));
  const lines = viewport.lines.slice(0, rows);
  while (lines.length < rows) lines.push('');

  const cursorRow = Math.min(rows, Math.max(1, Math.floor(viewport.cursorRow) + 1));
  const cursorColumn = Math.min(cols, Math.max(1, Math.floor(viewport.cursorColumn) + 1));
  return `${LIVE_PRESENTATION_RESET}${lines.join('\r\n')}\x1b[${cursorRow};${cursorColumn}H`;
}

export function createControllerReveal(
  controller: SessionController,
  getOutputQueue: () => Promise<void>,
  writeForeground: (chunk: string) => void
): ResumePresentationGateOptions['reveal'] {
  return async (reason, isCurrent) => {
    const observedQueue = getOutputQueue();
    await observedQueue;
    await controller.flushViewport();
    if (reason === 'quiet_period' && !isCurrent()) return null;

    // Include a chunk that raced the first queue snapshot before materializing
    // the viewport. The max-bound path may reveal the latest flushed state.
    const latestQueue = getOutputQueue();
    if (latestQueue !== observedQueue) {
      await latestQueue;
      await controller.flushViewport();
    }
    if (reason === 'quiet_period' && !isCurrent()) return null;

    const viewport = controller.getLiveViewportState();
    const size = controller.getTerminalSize();
    writeForeground(serializeResumeViewport(viewport, size));
    return size.rows;
  };
}
