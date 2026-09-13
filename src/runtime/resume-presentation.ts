import { LIVE_PRESENTATION_RESET, SessionController } from '../controller';

export const RESUME_PRESENTATION_QUIET_MS = 1000;
export const RESUME_PRESENTATION_MAX_MS = 10_000;
export const RESUME_PRESENTATION_MAX_POST_CUTOFF_CHUNKS = 2048;
export const RESUME_PRESENTATION_MAX_POST_CUTOFF_BYTES = 4 * 1024 * 1024;

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
  onAbsoluteMaxCutoff?: () => void;
  onAbsoluteMaxRevealReady?: () => void;
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
  private cutoffEstablished = false;
  private postCutoffQueue: string[] = [];
  private postCutoffBytes = 0;
  private postCutoffOverflowed = false;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ResumePresentationGateOptions) {
    this.quietMs = Math.max(0, options.quietMs ?? RESUME_PRESENTATION_QUIET_MS);
    this.maxMs = Math.max(this.quietMs, options.maxMs ?? RESUME_PRESENTATION_MAX_MS);
    options.onStarted?.();
    this.maxTimer = setTimeout(() => {
      this.maxReached = true;
      this.beginAbsoluteMaxReveal();
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

    if (this.cutoffEstablished) {
      this.queuePostCutoffChunk(chunk);
      return;
    }

    this.scheduleQuietTimer();
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.generation += 1;
    this.postCutoffQueue = [];
    this.postCutoffBytes = 0;
    this.clearTimers();
  }

  private queuePostCutoffChunk(chunk: string): void {
    const bytes = Buffer.byteLength(chunk, 'utf8');
    if (
      this.postCutoffQueue.length >= RESUME_PRESENTATION_MAX_POST_CUTOFF_CHUNKS ||
      this.postCutoffBytes + bytes > RESUME_PRESENTATION_MAX_POST_CUTOFF_BYTES
    ) {
      // The controller still receives this chunk through onOutput. If the
      // bounded foreground handoff queue saturates, materialize a fresh
      // viewport instead of retaining an unbounded raw-output buffer.
      this.postCutoffOverflowed = true;
      return;
    }

    this.postCutoffQueue.push(chunk);
    this.postCutoffBytes += bytes;
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
          if (reason === 'absolute_max' && this.postCutoffOverflowed) {
            // The bounded queue intentionally does not retain an unbounded
            // raw stream. Re-materialize the current controller viewport,
            // which contains the overflowed chunks, before opening passthrough.
            this.revealInFlight = false;
            this.postCutoffQueue = [];
            this.postCutoffBytes = 0;
            this.postCutoffOverflowed = false;
            this.beginAbsoluteMaxReveal();
            return;
          }

          if (reason === 'absolute_max') {
            this.options.onAbsoluteMaxRevealReady?.();
            for (const chunk of this.postCutoffQueue) {
              this.options.writeForeground(chunk);
            }
            this.postCutoffQueue = [];
            this.postCutoffBytes = 0;
            this.cutoffEstablished = false;
          }
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
          this.beginAbsoluteMaxReveal();
        } else {
          this.scheduleQuietTimer();
        }
      })
      .catch(() => {
        this.revealInFlight = false;
        if (this.state === 'closed') {
          if (this.maxReached) this.beginAbsoluteMaxReveal();
          else this.scheduleQuietTimer();
        }
      });
  }

  private beginAbsoluteMaxReveal(): void {
    if (this.state !== 'closed' || this.revealInFlight) return;
    this.cutoffEstablished = true;
    this.postCutoffQueue = [];
    this.postCutoffBytes = 0;
    this.postCutoffOverflowed = false;
    this.options.onAbsoluteMaxCutoff?.();
    this.beginReveal('absolute_max', this.generation);
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

    if (reason === 'quiet_period') {
      // A quiet reveal may have raced one final output chunk. Re-check the
      // current queue before materializing, but never do this for absolute_max:
      // its observed queue is the explicit cutoff boundary.
      const latestQueue = getOutputQueue();
      if (latestQueue !== observedQueue) {
        await latestQueue;
        await controller.flushViewport();
      }
      if (!isCurrent()) return null;
    }

    const viewport = controller.getLiveViewportState();
    const size = controller.getTerminalSize();
    writeForeground(serializeResumeViewport(viewport, size));
    return size.rows;
  };
}
