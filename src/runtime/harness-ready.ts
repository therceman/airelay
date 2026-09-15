/** Bottom viewport rows scanned for the harness ready footer. */
export const READY_FOOTER_ROWS = 3;

/**
 * Returns true when the harness ready footer pattern is visible in the bottom
 * viewport rows. Ready indicators are pinned status lines, so scanning only the
 * tail avoids false positives from replayed transcript text higher up.
 */
export function viewportShowsReady(lines: string[], pattern: RegExp): boolean {
  const tail = lines.slice(-READY_FOOTER_ROWS);
  return tail.some((line) => pattern.test(line));
}
