export type TerminalQueryKind =
  | 'cursor_position'
  | 'default_foreground'
  | 'default_background'
  | 'keyboard_enhancement'
  | 'device_attributes';

export interface TerminalQueryMatch {
  kind: TerminalQueryKind;
  sequence: string;
}

/** Short startup probe timeout; later replies to replayed output are stale. */
export const TERMINAL_QUERY_REPLY_WINDOW_MS = 100;
const MAX_PENDING_TERMINAL_QUERIES = 16;
const ESC = '\x1b';
const BEL = '\x07';
export const MAX_TERMINAL_QUERY_REPLY_LENGTH = 32;

function isDigits(value: string, maxLength = 5): boolean {
  return (
    value.length > 0 && value.length <= maxLength && [...value].every((c) => c >= '0' && c <= '9')
  );
}

function isParameterList(value: string, allowColon: boolean): boolean {
  let hasDigit = false;
  for (const character of value) {
    if (character >= '0' && character <= '9') {
      hasDigit = true;
    } else if (character !== ';' && !(allowColon && character === ':')) {
      return false;
    }
  }
  return hasDigit;
}

function isRgbColorReply(body: string, code: '10' | '11'): boolean {
  const prefix = `${code};rgb:`;
  if (!body.startsWith(prefix)) return false;
  const components = body.slice(prefix.length).split('/');
  return (
    components.length === 3 &&
    components.every(
      (component) =>
        component.length > 0 &&
        component.length <= 4 &&
        [...component].every(
          (character) =>
            (character >= '0' && character <= '9') ||
            (character >= 'a' && character <= 'f') ||
            (character >= 'A' && character <= 'F')
        )
    )
  );
}

/** Recognize only response forms for the explicitly approved terminal probes. */
export function classifyTerminalQueryReply(sequence: string): TerminalQueryKind | undefined {
  if (!sequence.startsWith(ESC)) return undefined;

  if (sequence.startsWith(`${ESC}]`)) {
    let body: string;
    if (sequence.endsWith(BEL)) {
      body = sequence.slice(2, -1);
    } else if (sequence.endsWith(`${ESC}\\`)) {
      body = sequence.slice(2, -2);
    } else {
      return undefined;
    }
    if (isRgbColorReply(body, '10')) return 'default_foreground';
    if (isRgbColorReply(body, '11')) return 'default_background';
    return undefined;
  }

  if (!sequence.startsWith(`${ESC}[`)) return undefined;
  const body = sequence.slice(2);
  if (!body.endsWith('R') && !body.endsWith('c') && !body.endsWith('u')) return undefined;
  const payload = body.slice(0, -1);

  if (body.endsWith('R')) {
    const [row, column, ...rest] = payload.split(';');
    if (!rest.length && isDigits(row) && isDigits(column)) return 'cursor_position';
  } else if (payload.startsWith('?')) {
    const parameters = payload.slice(1);
    if (body.endsWith('c') && isParameterList(parameters, false)) return 'device_attributes';
    if (body.endsWith('u') && isParameterList(parameters, true)) return 'keyboard_enhancement';
  }
  return undefined;
}

function findTerminalReply(
  input: string,
  start: number
): { sequence: string; end: number; kind: TerminalQueryKind } | undefined {
  if (input[start] !== ESC) return undefined;

  if (input.startsWith(`${ESC}]`, start)) {
    const limit = Math.min(input.length, start + MAX_TERMINAL_QUERY_REPLY_LENGTH);
    for (let index = start + 2; index < limit; index += 1) {
      let end: number | undefined;
      if (input[index] === BEL) end = index + 1;
      else if (input.startsWith(`${ESC}\\`, index)) end = index + 2;
      if (end !== undefined) {
        const sequence = input.slice(start, end);
        const kind = classifyTerminalQueryReply(sequence);
        return kind ? { sequence, end, kind } : undefined;
      }
    }
    return undefined;
  }

  if (input.startsWith(`${ESC}[`, start)) {
    const limit = Math.min(input.length, start + MAX_TERMINAL_QUERY_REPLY_LENGTH);
    for (let index = start + 2; index < limit; index += 1) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        const end = index + 1;
        const sequence = input.slice(start, end);
        const kind = classifyTerminalQueryReply(sequence);
        return kind ? { sequence, end, kind } : undefined;
      }
    }
  }
  return undefined;
}

type TerminalQueryDefinition = TerminalQueryMatch;

const QUERY_DEFINITIONS: readonly TerminalQueryDefinition[] = [
  { kind: 'cursor_position', sequence: '\x1b[6n' },
  { kind: 'default_foreground', sequence: '\x1b]10;?\x1b\\' },
  { kind: 'default_background', sequence: '\x1b]11;?\x1b\\' },
  { kind: 'keyboard_enhancement', sequence: '\x1b[?u' },
  { kind: 'device_attributes', sequence: '\x1b[c' },
];

/** Maximum retained state is the longest approved query prefix. */
export const MAX_TERMINAL_QUERY_PREFIX_LENGTH =
  Math.max(...QUERY_DEFINITIONS.map(({ sequence }) => sequence.length)) - 1;

function findQuery(sequence: string): TerminalQueryDefinition | undefined {
  return QUERY_DEFINITIONS.find((definition) => definition.sequence === sequence);
}

function isQueryPrefix(sequence: string): boolean {
  return QUERY_DEFINITIONS.some((definition) => definition.sequence.startsWith(sequence));
}

/**
 * Extracts only exact, explicitly approved terminal queries from a stream.
 * Non-query bytes are returned for the bounded absolute-max handoff queue;
 * callers may discard them while ordinary resume hydration is suppressed.
 */
export class TerminalQueryExtractor {
  private pending = '';

  feed(chunk: string, onQuery: (query: TerminalQueryMatch) => void): string {
    let nonQuery = '';

    for (const character of chunk) {
      if (!this.pending) {
        if (character === ESC) {
          this.pending = character;
        } else {
          nonQuery += character;
        }
        continue;
      }

      const candidate = this.pending + character;
      const query = findQuery(candidate);
      if (query) {
        onQuery(query);
        this.pending = '';
        continue;
      }

      if (isQueryPrefix(candidate)) {
        this.pending = candidate;
        continue;
      }

      if (candidate.endsWith(ESC)) {
        nonQuery += candidate.slice(0, -1);
        this.pending = ESC;
      } else {
        nonQuery += candidate;
        this.pending = '';
      }
    }

    return nonQuery;
  }

  reset(): void {
    this.pending = '';
  }

  getBufferedLength(): number {
    return this.pending.length;
  }
}

/**
 * Allows attach-originated terminal replies only shortly after this runtime
 * emitted the corresponding query. This prevents replies caused by replayed
 * bootstrap bytes from becoming literal harness input.
 */
export class TerminalQueryReplyTracker {
  private readonly extractor = new TerminalQueryExtractor();
  private pending: { kind: TerminalQueryKind; expiresAt: number }[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly replyWindowMs = TERMINAL_QUERY_REPLY_WINDOW_MS
  ) {}

  observeOutput(chunk: string): void {
    const now = this.now();
    this.prune(now);
    this.extractor.feed(chunk, ({ kind }) => {
      this.pending.push({ kind, expiresAt: now + this.replyWindowMs });
      if (this.pending.length > MAX_PENDING_TERMINAL_QUERIES) this.pending.shift();
    });
  }

  /** Preserve ordinary input; pass a terminal reply only when its query is live. */
  filterInput(input: string): string {
    const now = this.now();
    this.prune(now);
    const output: string[] = [];
    let copiedFrom = 0;
    let index = 0;
    while (index < input.length) {
      const reply = findTerminalReply(input, index);
      if (!reply) {
        index += 1;
        continue;
      }

      output.push(input.slice(copiedFrom, index));
      const pendingIndex = this.pending.findIndex((query) => query.kind === reply.kind);
      if (pendingIndex >= 0) {
        this.pending.splice(pendingIndex, 1);
        output.push(reply.sequence);
      }
      index = reply.end;
      copiedFrom = index;
    }
    output.push(input.slice(copiedFrom));
    return output.join('');
  }

  reset(): void {
    this.pending = [];
    this.extractor.reset();
  }

  private prune(now: number): void {
    this.pending = this.pending.filter((query) => query.expiresAt > now);
  }
}
