export type HarnessType = 'opencode' | 'codex' | 'unknown';

const HARNESS_PATTERNS: Record<string, string[]> = {
  opencode: ['opencode'],
  codex: ['codex', 'o1', 'o3'],
};

export function detectHarness(executable: string): HarnessType {
  const lower = executable.toLowerCase();
  for (const [harness, patterns] of Object.entries(HARNESS_PATTERNS)) {
    if (patterns.some((p) => lower.includes(p))) {
      return harness as HarnessType;
    }
  }
  return 'unknown';
}

export function getSessionArgExample(harness: HarnessType): string {
  switch (harness) {
    case 'opencode':
      return '-s session-id';
    case 'codex':
      return 'resume session-id';
    default:
      return '--session-id';
  }
}

/**
 * Declared input behavior capabilities per harness type.
 * Used instead of hardcoded harness-name branching for prompt submit decisions.
 */
export interface HarnessCapabilities {
  /**
   * How the submit value should be interpreted by the controller.
   * - 'byte': single control character (e.g., '\r' for Enter)
   * - 'sequence': multi-byte terminal sequence (e.g., CSI-u key event)
   */
  submitMode: 'byte' | 'sequence';

  /**
   * The actual string to write after prompt text for submission.
   * Written directly to the PTY by the controller handler.
   *
   * Examples:
   * - "\r" (0x0D) = Enter key
   */
  submitValue: string;

  /**
   * Delay before writing submit sequence after text, in milliseconds.
   * Useful for TUIs that require a short settle time before submit key events.
   */
  submitDelayMs: number;
}

const HARNESS_CAPABILITIES: Record<HarnessType, HarnessCapabilities> = {
  opencode: {
    submitMode: 'byte',
    submitValue: '\r',
    submitDelayMs: 0,
  },
  codex: {
    submitMode: 'byte',
    // Enter (\r) with TEXT_TO_SUBMIT_DELAY_MS delay works for Codex in practice.
    // CSI-u sequences are not handled by Codex's terminal mode.
    submitValue: '\r',
    submitDelayMs: 0,
  },
  unknown: {
    submitMode: 'byte',
    submitValue: '\r',
    submitDelayMs: 0,
  },
};

/**
 * Returns the declared capabilities for a given harness type.
 * Unknown harnesses default to Enter semantics for broadest compatibility.
 */
export function getHarnessCapabilities(harness: HarnessType): HarnessCapabilities {
  return (
    HARNESS_CAPABILITIES[harness] || { submitMode: 'byte', submitValue: '\r', submitDelayMs: 0 }
  );
}

export function getArgsHelpMessage(harness: HarnessType, hasSession: boolean): string {
  if (hasSession) {
    return 'Additional args (or press enter to use session)';
  }
  const example = getSessionArgExample(harness);
  return `Additional args (e.g., ${example})`;
}

export interface SessionPattern {
  idPattern: RegExp;
  namePattern?: RegExp;
}

export function getSessionPatterns(harness: HarnessType): SessionPattern[] {
  switch (harness) {
    case 'opencode':
      return [
        {
          idPattern: /opencode -s (ses_[a-zA-Z0-9]+)/,
          namePattern: /Session\s+([^\n\r]+)/,
        },
        {
          idPattern: /opencode --session (ses_[a-zA-Z0-9]+)/,
        },
      ];
    case 'codex':
      return [
        {
          idPattern: /codex resume ([a-zA-Z0-9]+)/,
        },
        {
          idPattern: /codex --session ([a-zA-Z0-9]+)/,
        },
      ];
    default:
      return [
        {
          idPattern: /Session[:\s]+([a-zA-Z0-9_]+)/,
        },
      ];
  }
}
