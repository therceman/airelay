export const BODY_TO_MARKER_DELAY_MS = 100;

export interface CommandInputSequenceOptions {
  body: string;
  marker?: string;
  submit: string;
  totalDelayMs: number;
  write: (data: string) => void;
  onMarkerWritten?: () => void;
  delay?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Write body, visible marker and submit as separate ordered PTY operations. */
export async function writeCommandInput(options: CommandInputSequenceOptions): Promise<void> {
  const delay = options.delay || defaultDelay;
  const totalDelayMs = Math.max(0, Math.floor(options.totalDelayMs));
  const markerDelayMs = options.marker
    ? Math.min(BODY_TO_MARKER_DELAY_MS, totalDelayMs)
    : totalDelayMs;

  if (options.body) options.write(options.body);
  if (markerDelayMs > 0) await delay(markerDelayMs);

  if (options.marker) {
    options.write(` ${options.marker}`);
    options.onMarkerWritten?.();
  }

  const submitDelayMs = totalDelayMs - markerDelayMs;
  if (submitDelayMs > 0) await delay(submitDelayMs);
  options.write(options.submit);
}
