const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

export const HIBERNATE_DISABLED = 'off';
export const MAX_HIBERNATE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Parse a human-readable duration used by public airelay settings. */
export function parseDurationMs(value: string): number | null {
  if (value === HIBERNATE_DISABLED) return -1;

  const match = DURATION_PATTERN.exec(value);
  if (!match) return null;

  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const multiplier = multipliers[match[2]];
  const milliseconds = amount * multiplier;

  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
  if (milliseconds > MAX_HIBERNATE_AFTER_MS) return null;
  return milliseconds;
}

export function isValidDuration(value: string): boolean {
  return parseDurationMs(value) !== null;
}
