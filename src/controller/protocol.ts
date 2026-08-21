import {
  IpcRequest,
  IpcResponse,
  IpcErrorResponse,
  IpcMethod,
  IpcErrorCodes,
  IpcErrorReasons,
  IpcError,
  IpcErrorReason,
  SessionInputParams,
  SessionRawInputParams,
  SessionResizeParams,
} from '../types/controller';

/** Keep prompt validation bounded without rejecting normal agent requests. */
export const MAX_SESSION_INPUT_BYTES = 256 * 1024;

function hasInvalidUnicode(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasUnsupportedControl(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validateSessionInputText(text: string): {
  reason: IpcErrorReason;
  message: string;
} | null {
  if (hasInvalidUnicode(text)) {
    return {
      reason: IpcErrorReasons.INVALID_ENCODING,
      message: '"session.input" text contains an invalid Unicode surrogate sequence',
    };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_SESSION_INPUT_BYTES) {
    return {
      reason: IpcErrorReasons.TOO_LONG,
      message: `"session.input" text exceeds the ${MAX_SESSION_INPUT_BYTES}-byte limit`,
    };
  }
  if (hasUnsupportedControl(text)) {
    return {
      reason: IpcErrorReasons.UNSUPPORTED_CHARS,
      message: '"session.input" text contains unsupported control characters',
    };
  }
  if (text.normalize('NFC').trim().length === 0) {
    return {
      reason: IpcErrorReasons.EMPTY_AFTER_NORMALIZATION,
      message: '"session.input" text is empty after normalization',
    };
  }
  return null;
}

const VALID_METHODS: IpcMethod[] = [
  'ping',
  'session.info',
  'session.input',
  'session.output',
  'session.viewport',
  'session.interrupt',
  'session.attach',
  'session.detach',
  'session.input.raw',
  'session.resize',
];

export function parseRequest(raw: string): IpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IpcError(
      IpcErrorCodes.PARSE_ERROR,
      'Malformed JSON: failed to parse request body',
      IpcErrorReasons.PROTOCOL_PARSE_ERROR
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new IpcError(
      IpcErrorCodes.INVALID_REQUEST,
      'Request must be a JSON object',
      IpcErrorReasons.INVALID_REQUEST
    );
  }

  const req = parsed as Record<string, unknown>;

  if (typeof req.id !== 'string' || req.id.length === 0) {
    throw new IpcError(
      IpcErrorCodes.INVALID_REQUEST,
      'Request must have a non-empty string "id" field',
      IpcErrorReasons.INVALID_REQUEST
    );
  }

  if (typeof req.method !== 'string' || !VALID_METHODS.includes(req.method as IpcMethod)) {
    const received = typeof req.method === 'string' ? req.method : typeof req.method;
    throw new IpcError(
      IpcErrorCodes.METHOD_NOT_FOUND,
      `Unknown method "${received}". Valid methods: ${VALID_METHODS.join(', ')}`,
      IpcErrorReasons.UNSUPPORTED_METHOD
    );
  }

  const method = req.method as IpcMethod;
  const params = (
    typeof req.params === 'object' && req.params !== null
      ? (req.params as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;

  if (method === 'session.input') {
    const inputParams = params as unknown as SessionInputParams;
    const hasEnter = inputParams.enter !== false && inputParams.enter !== undefined;
    if (typeof inputParams.text !== 'string' && inputParams.text !== undefined) {
      throw new IpcError(
        IpcErrorCodes.INVALID_PARAMS,
        '"text" must be a string if provided',
        IpcErrorReasons.INVALID_TYPE
      );
    }

    if (typeof inputParams.text === 'string') {
      const validation = validateSessionInputText(inputParams.text);
      if (validation) {
        throw new IpcError(IpcErrorCodes.INVALID_PARAMS, validation.message, validation.reason);
      }
    } else if (!hasEnter) {
      throw new IpcError(
        IpcErrorCodes.INVALID_PARAMS,
        '"session.input" requires non-empty "text" or a submit action via "enter"',
        IpcErrorReasons.EMPTY_AFTER_NORMALIZATION
      );
    }
  }

  if (method === 'session.input.raw') {
    const rawParams = params as unknown as SessionRawInputParams;
    if (typeof rawParams.data !== 'string') {
      throw new IpcError(
        IpcErrorCodes.INVALID_PARAMS,
        '"session.input.raw" requires a string "data"',
        IpcErrorReasons.INVALID_TYPE
      );
    }
  }

  if (method === 'session.resize') {
    const resizeParams = params as unknown as SessionResizeParams;
    const cols = resizeParams.cols;
    const rows = resizeParams.rows;
    const validSize =
      typeof cols === 'number' &&
      Number.isInteger(cols) &&
      cols > 0 &&
      typeof rows === 'number' &&
      Number.isInteger(rows) &&
      rows > 0;
    if (!validSize) {
      throw new IpcError(
        IpcErrorCodes.INVALID_PARAMS,
        '"session.resize" requires positive integer "cols" and "rows"',
        IpcErrorReasons.INVALID_PARAMS
      );
    }
  }

  return { id: req.id as string, method, params };
}

export function createSuccessResponse(id: string, data: unknown): IpcResponse {
  return { id, type: 'success', data };
}

export function createErrorResponse(
  id: string | null,
  code: string,
  message: string,
  reason?: IpcErrorReason
): IpcErrorResponse {
  return {
    id: id || 'unknown',
    type: 'error',
    error: reason ? { code, message, reason } : { code, message },
  };
}

export function serializeResponse(response: IpcResponse): string {
  return JSON.stringify(response) + '\n';
}

/**
 * Serialize a raw PTY output notification for an attached stream client.
 * JSON-encodes the chunk as a single string so embedded newlines/control
 * bytes cannot break the newline-delimited IPC framing.
 */
export function serializeStreamFrame(chunk: string): string {
  return JSON.stringify({ type: 'stream', data: { chunk } }) + '\n';
}

/**
 * Processes a buffer string, extracting complete newline-delimited lines.
 * Calls onLine for each complete line. Returns the incomplete remainder.
 * Used by both the IPC server (controller) and client (prompt) for framing.
 */
export function readLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split('\n');
  const remainder = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      onLine(trimmed);
    }
  }
  return remainder;
}
