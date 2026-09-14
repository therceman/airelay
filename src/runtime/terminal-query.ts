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

type TerminalQueryDefinition = TerminalQueryMatch;

const QUERY_DEFINITIONS: readonly TerminalQueryDefinition[] = [
  { kind: 'cursor_position', sequence: '\x1b[6n' },
  { kind: 'default_foreground', sequence: '\x1b]10;?\x1b\\' },
  { kind: 'default_background', sequence: '\x1b]11;?\x1b\\' },
  { kind: 'keyboard_enhancement', sequence: '\x1b[?u' },
  { kind: 'device_attributes', sequence: '\x1b[c' },
];

const ESC = '\x1b';

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
