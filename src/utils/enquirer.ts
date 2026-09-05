/**
 * Keep submitted Enquirer prompts aligned in terminals where the default
 * Unicode check mark is rendered as a double-width glyph.
 */
const AIRELAY_PROMPT_SYMBOLS = {
  prefix: {
    submitted: '>',
  },
} as const;

export function withAirelayPromptSymbols<T extends Record<string, unknown>>(
  options: T
): T & { symbols: typeof AIRELAY_PROMPT_SYMBOLS } {
  return {
    ...options,
    symbols: AIRELAY_PROMPT_SYMBOLS,
  };
}
