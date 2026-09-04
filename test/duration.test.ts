import { isValidDuration, parseDurationMs } from '../src/utils/duration';

describe('hibernate duration', () => {
  it('parses supported units', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('5m')).toBe(5 * 60_000);
    expect(parseDurationMs('2h')).toBe(2 * 60 * 60_000);
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60_000);
  });

  it('supports disabling and rejects unsafe values', () => {
    expect(parseDurationMs('off')).toBe(-1);
    expect(isValidDuration('off')).toBe(true);
    expect(parseDurationMs('0m')).toBeNull();
    expect(parseDurationMs('31d')).toBeNull();
    expect(parseDurationMs('five minutes')).toBeNull();
  });
});
