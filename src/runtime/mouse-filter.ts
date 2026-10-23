/**
 * DEC private modes that hand pointer events to the application instead of the
 * terminal's native selection: x10 (9), click/drag/motion tracking (1000/1002/
 * 1003), mouse report encodings (1005/1006/1015/1016) and alternate scroll
 * (1007). Stripping only these keeps every other mode — alternate buffer
 * (1049), bracketed paste (2004), focus events (1004), synchronized output
 * (2026) — untouched.
 */
const MOUSE_TRACKING_MODES = new Set([
  '9',
  '1000',
  '1002',
  '1003',
  '1005',
  '1006',
  '1007',
  '1015',
  '1016',
]);
const ANY_EVENT_MOUSE_MODE = '1003';

const ESC = String.fromCharCode(0x1b);
const MOUSE_DECSET_PATTERN = new RegExp(`${ESC}\\[\\?([0-9;]*)([hl])`, 'g');
/** Trailing bytes that could still grow into a CSI ? ... h/l sequence. */
const PENDING_PREFIX_PATTERN = new RegExp(`${ESC}(?:\\[\\??[0-9;]*)?$`);
/** A complete candidate is at most ESC [ ? <six 4-digit modes + separators> h. */
const MAX_PENDING_BYTES = 64;

/** Disables every mouse-tracking mode the filter removes. */
export const MOUSE_TRACKING_RESET = [...MOUSE_TRACKING_MODES]
  .map((mode) => `${ESC}[?${mode}l`)
  .join('');

/**
 * One-shot removal for complete strings (screen serializations, reveal dumps)
 * where no chunk-split sequences can exist.
 */
export function stripMouseTrackingSequences(text: string): string {
  return text.replace(MOUSE_DECSET_PATTERN, (sequence, params: string, final: string) => {
    const modes = params.split(';').filter(Boolean);
    const remaining = modes.filter((mode) => !MOUSE_TRACKING_MODES.has(mode));
    if (remaining.length === modes.length) return sequence;
    return remaining.length > 0 ? `${ESC}[?${remaining.join(';')}${final}` : '';
  });
}

/** Downgrade any-event tracking to drag so snapshots retain wheel input without hover reports. */
export function stripAnyEventMouseSequences(text: string): string {
  return text.replace(MOUSE_DECSET_PATTERN, (sequence, params: string, final: string) => {
    const modes = params.split(';').filter(Boolean);
    if (!modes.includes(ANY_EVENT_MOUSE_MODE)) return sequence;
    const safeModes = modes.map((mode) => (mode === ANY_EVENT_MOUSE_MODE ? '1002' : mode));
    return `${ESC}[?${safeModes.join(';')}${final}`;
  });
}

/**
 * Incremental terminal-bound mouse-mode filter. Any-event policy suppresses
 * unsolicited pointer reports; all policy suppresses every tracked mouse mode.
 * A trailing partial sequence is retained until the next chunk disambiguates
 * it; retained state is bounded.
 */
export class MouseTrackingFilter {
  private pending = '';

  constructor(private readonly policy: 'all' | 'any-event' = 'all') {}

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

    return this.policy === 'any-event'
      ? stripAnyEventMouseSequences(body)
      : stripMouseTrackingSequences(body);
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
