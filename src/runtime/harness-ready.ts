/** Bottom viewport rows scanned for the harness ready footer. */
export const READY_FOOTER_ROWS = 3;

/** Bounded wait for command prompts while a harness restores its interactive UI. */
export const READY_INPUT_FAIL_OPEN_MS = 60_000;

/** Keep the prompt IPC open through readiness fail-open and delivery response. */
export const READY_PROMPT_IPC_TIMEOUT_MS = READY_INPUT_FAIL_OPEN_MS + 5_000;

/**
 * Returns true when the harness ready footer pattern is visible in the bottom
 * viewport rows. Ready indicators are pinned status lines, so scanning only the
 * tail avoids false positives from replayed transcript text higher up.
 */
export function viewportShowsReady(lines: string[], pattern: RegExp): boolean {
  const tail = lines.slice(-READY_FOOTER_ROWS);
  return tail.some((line) => pattern.test(line));
}
