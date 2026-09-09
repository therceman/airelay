import { isInputTextVisible } from './input-submit-watcher';

export const WAKE_INPUT_PROBE = ':::';
export const WAKE_INPUT_PROBE_ERASE = '\x7f'.repeat(WAKE_INPUT_PROBE.length);
export const WAKE_INPUT_PROBE_TIMEOUT_MS = 20000;
export const WAKE_INPUT_PROBE_POLL_MS = 100;
export const WAKE_INPUT_PROBE_ERASE_TIMEOUT_MS = 2000;

export interface InputProbeOptions {
  write: (data: string) => void;
  readViewport: () => string[];
  timeoutMs: number;
  eraseTimeoutMs: number;
  pollIntervalMs: number;
}

export async function waitForInputProbe(options: InputProbeOptions): Promise<void> {
  options.write(WAKE_INPUT_PROBE);
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (isInputTextVisible(WAKE_INPUT_PROBE, options.readViewport())) break;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }

  if (!isInputTextVisible(WAKE_INPUT_PROBE, options.readViewport())) {
    throw new Error(`Input readiness probe timed out after ${options.timeoutMs}ms.`);
  }

  options.write(WAKE_INPUT_PROBE_ERASE);
  const eraseDeadline = Date.now() + options.eraseTimeoutMs;
  while (Date.now() < eraseDeadline) {
    if (!isInputTextVisible(WAKE_INPUT_PROBE, options.readViewport())) return;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }

  throw new Error('Input readiness probe could not be removed.');
}
