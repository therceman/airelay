import net from 'net';
import { findSessionByKey } from './sessions';
import { getIpcEndpointPath } from '../utils/ipc-path';
import { readLines } from '../controller/protocol';
import { detectHarness, getHarnessCapabilities } from '../utils/harness';
import { loadConfig } from '../config/load';

const IPC_TIMEOUT = 5000;

/**
 * Delay in ms between writing prompt text and writing the submit sequence.
 * Required for TUI apps (especially under tmux) to process text input
 * before the submit key arrives. Without this delay the submit byte can
 * land in the wrong buffer position and produce a newline instead of submit.
 */
const TEXT_TO_SUBMIT_DELAY_MS = 500;

interface IpcClientRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface IpcClientResponse {
  type: string;
  error?: { code: string; message: string };
}

function sendIpcRequest(
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

export interface PromptOptions {
  enter?: boolean | string;
  onlyEnter?: boolean;
  onlySequence?: string;
}

export async function promptCommand(
  sessionKeyOrId: string,
  text?: string,
  options?: PromptOptions
): Promise<number> {
  const resolvedText = text || undefined;
  const onlyEnter = options?.onlyEnter === true;
  const onlySequence = options?.onlySequence;

  if (!resolvedText && !onlyEnter && !onlySequence) {
    console.error('Error: Text is required unless --only-enter or --only-sequence is used.');
    console.error('Usage: airelay prompt <session> [text]');
    console.error('       airelay prompt <session> --only-enter');
    console.error('       airelay prompt <session> --only-sequence <seq>');
    return 1;
  }

  const found = findSessionByKey(sessionKeyOrId);
  if (!found) {
    console.error(`Error: Session not found: ${sessionKeyOrId}`);
    console.error('Use "airelay list --sessions" to see available sessions.');
    return 1;
  }

  const sessionKey = found.session.sessionKey || found.session.id;
  const endpointPath = found.session.controllerEndpoint || getIpcEndpointPath(sessionKey);

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
    const config = loadConfig();
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
    const config = loadConfig();
    const profile = config.profiles[found.profile] as { executable?: string } | undefined;
    const harness = profile?.executable ? detectHarness(profile.executable) : 'unknown';
    const caps = getHarnessCapabilities(harness);
    submitByte = caps.submitValue;
    submitDelayMs = TEXT_TO_SUBMIT_DELAY_MS;
  }

  try {
    const response = await sendIpcRequest(endpointPath, {
      id: 'prompt-1',
      method: 'session.input',
      params: { text: resolvedText, enter: submitByte, submitDelayMs },
    });

    if (response.type === 'error' && response.error) {
      console.error(`Error: IPC error from controller: ${response.error.message}`);
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
