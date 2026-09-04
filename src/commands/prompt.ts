import net from 'net';
import { randomUUID } from 'crypto';
import { findSessionByKey, pruneStaleSessions } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { readLines } from '../controller/protocol';
import { detectHarness, getHarnessCapabilities } from '../utils/harness';
import { loadConfig } from '../config/load';
import { DEFAULT_PROMPT_MAX_LENGTH, UNLIMITED_PROMPT_MAX_LENGTH } from '../config/schema';
import { preflightVersionCheck } from './session-ipc';

const IPC_TIMEOUT = 5000;

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', (err: Error) => {
      reject(err);
    });
    process.stdin.resume();
  });
}

/**
 * Delay in ms between writing prompt text and writing the submit sequence.
 * Required for TUI apps (especially under tmux) to process text input
 * before the submit key arrives. Without this delay the submit byte can
 * land in the wrong buffer position and produce a newline instead of submit.
 */
const TEXT_TO_SUBMIT_DELAY_MS = 1000;

interface IpcClientRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface IpcClientResponse {
  type: string;
  data?: unknown;
  error?: { code: string; message: string; reason?: string };
}

function sendIpcRequestOnce(
  endpointPath: string,
  request: IpcClientRequest
): Promise<IpcClientResponse> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      socket.destroy();
    };

    const timeout = setTimeout(() => {
      cleanup();
      const err = new Error('IPC request timed out');
      reject(err);
    }, IPC_TIMEOUT);

    socket.connect(endpointPath, () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (data: Buffer) => {
      buffer = readLines(buffer + data.toString(), (line) => {
        cleanup();
        try {
          resolve(JSON.parse(line) as IpcClientResponse);
        } catch {
          reject(new Error('Invalid IPC response: failed to parse JSON'));
        }
      });
    });

    socket.on('error', (err: Error) => {
      cleanup();
      reject(err);
    });

    socket.on('close', () => {
      cleanup();
      if (!cleanedUp) {
        reject(new Error('Connection closed without response'));
      }
    });
  });
}

function isRetryableTransportError(error: unknown): boolean {
  const candidate = error as Error & { code?: string };
  return (
    candidate.code === 'ENOENT' ||
    candidate.code === 'ECONNREFUSED' ||
    candidate.code === 'ENOTCONN' ||
    candidate.message?.includes('timed out') === true ||
    candidate.message?.includes('Connection closed') === true
  );
}

/** Retry transport loss with the same request and delivery identity. */
async function sendIpcRequest(
  endpointPath: string,
  request: IpcClientRequest,
  maxAttempts = 2
): Promise<IpcClientResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await sendIpcRequestOnce(endpointPath, request);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableTransportError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('IPC request failed');
}

export interface PromptOptions {
  enter?: boolean | string;
  onlyEnter?: boolean;
  onlySequence?: string;
  noSender?: boolean;
  sender?: string;
  noWarn?: boolean;
  stdin?: boolean;
  fastEnter?: boolean;
  deliveryId?: string;
}

export async function promptCommand(
  sessionKeyOrId: string,
  text?: string,
  options?: PromptOptions
): Promise<number> {
  const onlyEnter = options?.onlyEnter === true;
  const onlySequence = options?.onlySequence;
  const stdin = options?.stdin === true;
  const fastEnter = options?.fastEnter === true;

  let resolvedText: string | undefined;

  if (stdin) {
    if (text) {
      console.error('Error: --stdin cannot be combined with inline text or --text.');
      return 1;
    }
    const stdinText = await readStdin();
    if (!stdinText || stdinText.trim().length === 0) {
      console.error('Error: Empty input from stdin.');
      console.error('Usage: echo "message" | airelay prompt <session> --stdin');
      return 1;
    }
    resolvedText = stdinText;
  } else {
    resolvedText = text || undefined;
  }

  if (!resolvedText && !onlyEnter && !onlySequence) {
    console.error(
      'Error: Text is required unless --only-enter, --only-sequence, or --stdin is used.'
    );
    console.error('Usage: airelay prompt <session> [text]');
    console.error('       airelay prompt <session> --stdin');
    console.error('       airelay prompt <session> --only-enter');
    console.error('       airelay prompt <session> --only-sequence <seq>');
    return 1;
  }

  // Compute sender prefix
  let sender: string | undefined;
  if (options?.sender) {
    sender = options.sender;
  } else if (!options?.noSender) {
    sender = process.env.AIRELAY_SESSION_KEY;
  }
  const finalText = sender && resolvedText ? `[from=${sender}] ${resolvedText}` : resolvedText;

  await pruneStaleSessions();

  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    console.error('Use "airelay list --sessions" to see available sessions.');
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);
  const deliveryId = options?.deliveryId || randomUUID();
  const config = loadConfig();
  const maxPromptLength = config.settings?.promptMaxLength ?? DEFAULT_PROMPT_MAX_LENGTH;
  const promptLength = resolvedText ? Array.from(resolvedText).length : 0;
  if (maxPromptLength !== UNLIMITED_PROMPT_MAX_LENGTH && promptLength > maxPromptLength) {
    console.error(
      `Error: Prompt is too long (${promptLength} characters). Maximum is ${maxPromptLength}.`
    );
    console.error(
      'Set a different limit with: airelay config set settings.promptMaxLength <number|unlimited>'
    );
    return 1;
  }

  // Determine submit byte based on mode and profile harness
  const callerEnter = options?.enter;
  let submitByte: string | boolean;
  let submitDelayMs = 0;

  if (onlySequence) {
    // --only-sequence: use provided bytes directly as submit value
    submitByte = onlySequence;
    submitDelayMs = TEXT_TO_SUBMIT_DELAY_MS;
  } else if (onlyEnter) {
    // --only-enter: send harness-default submit with no text
    const profile = config.profiles[found.profile] as { executable?: string } | undefined;
    const harness = profile?.executable ? detectHarness(profile.executable) : 'unknown';
    const caps = getHarnessCapabilities(harness);
    submitByte = caps.submitValue;
    submitDelayMs = TEXT_TO_SUBMIT_DELAY_MS;
  } else if (callerEnter === false) {
    submitByte = false;
  } else if (typeof callerEnter === 'string') {
    // Caller explicitly specified the submit byte
    submitByte = callerEnter;
    submitDelayMs = TEXT_TO_SUBMIT_DELAY_MS;
  } else {
    // Default: resolve from harness capabilities
    const profile = config.profiles[found.profile] as { executable?: string } | undefined;
    const harness = profile?.executable ? detectHarness(profile.executable) : 'unknown';
    const caps = getHarnessCapabilities(harness);
    submitByte = caps.submitValue;
    submitDelayMs = TEXT_TO_SUBMIT_DELAY_MS;
  }

  // Preflight version parity check (blocking — hard-stop on major mismatch)
  const parity = await preflightVersionCheck(endpointPath);
  if (parity.error) {
    console.error(`Error: ${parity.error}`);
    return 1;
  }
  if (!options?.noWarn) {
    for (const w of parity.warnings) {
      console.warn(`Warning: ${w}`);
    }
  }

  try {
    const response = await sendIpcRequest(endpointPath, {
      id: `prompt-${deliveryId}`,
      method: 'session.input',
      params: {
        text: finalText,
        deliveryId,
        enter: submitByte,
        submitDelayMs: fastEnter ? 0 : submitDelayMs,
      },
    });

    if (response.type === 'error' && response.error) {
      const reason = response.error.reason ? ` [reason=${response.error.reason}]` : '';
      console.error(`Error: IPC error from controller${reason}: ${response.error.message}`);
      return 1;
    }

    console.log('✓ Prompt sent successfully.');
    return 0;
  } catch (err: unknown) {
    const nodeErr = err as Error & { code?: string };

    if (
      nodeErr.code === 'ENOENT' ||
      nodeErr.code === 'ECONNREFUSED' ||
      nodeErr.code === 'ENOTCONN'
    ) {
      console.error(`Error: Controller offline for session: ${sessionKeyOrId}`);
      console.error('Make sure the session is active and running.');
      return 1;
    }

    if (nodeErr.message?.includes('timed out')) {
      console.error('Error: IPC timeout - controller did not respond.');
      return 1;
    }

    if (nodeErr.message?.includes('Invalid IPC response')) {
      console.error(`Error: ${nodeErr.message}`);
      return 1;
    }

    console.error(`Error: IPC communication failed - ${nodeErr.message || 'Unknown error'}`);
    return 1;
  }
}
