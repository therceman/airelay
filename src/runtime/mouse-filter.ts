/**
 * DEC private modes that hand pointer events to the application instead of the
 * terminal's native selection. Stripping only these keeps every other mode —
 * alternate buffer (1049), bracketed paste (2004), focus events (1004),
 * synchronized output (2026) — untouched.
 */
const MOUSE_TRACKING_MODES = new Set(['1000', '1002', '1003', '1006', '1007', '1015']);

const ESC = String.fromCharCode(0x1b);
const MOUSE_DECSET_PATTERN = new RegExp(`${ESC}\\[\\?([0-9;]*)([hl])`, 'g');
/** Trailing bytes that could still grow into a CSI ? ... h/l sequence. */
const PENDING_PREFIX_PATTERN = new RegExp(`${ESC}(?:\\[\\??[0-9;]*)?$`);
/** A complete candidate is at most ESC [ ? <six 4-digit modes + separators> h. */
const MAX_PENDING_BYTES = 64;

function isMouseModeSequence(params: string): boolean {
  const modes = params.split(';').filter((mode) => mode.length > 0);
  return modes.length > 0 && modes.every((mode) => MOUSE_TRACKING_MODES.has(mode));
}

/**
 * Incremental filter that removes mouse-tracking DECSET/DECRST sequences from a
 * terminal-bound output stream. The harness keeps its own mouse state — only
 * the user's terminal is prevented from entering mouse-report mode, so native
 * drag-select stays available. A trailing partial sequence is retained until
 * the next chunk disambiguates it; retained state is bounded.
 */
export class MouseTrackingFilter {
  private pending = '';

  feed(chunk: string): string {
    if (!chunk) return '';
    const input = this.pending + chunk;
    this.pending = '';

    let body = input;
    const partial = PENDING_PREFIX_PATTERN.exec(input);
    if (partial) {
      body = input.slice(0, partial.index);
      this.pending = partial[0];
      if (this.pending.length > MAX_PENDING_BYTES) {
        body += this.pending;
        this.pending = '';
      }
    }

    return body.replace(MOUSE_DECSET_PATTERN, (sequence, params: string) =>
      isMouseModeSequence(params) ? '' : sequence
    );
  }

  /** Emit any retained partial sequence verbatim at end of stream. */
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return rest;
  }

  reset(): void {
    this.pending = '';
  }
}
