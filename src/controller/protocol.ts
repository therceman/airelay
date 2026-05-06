import {
  IpcRequest,
  IpcResponse,
  IpcErrorResponse,
  IpcMethod,
  IpcErrorCodes,
  IpcError,
  SessionInputParams,
} from '../types/controller';

const VALID_METHODS: IpcMethod[] = [
  'ping',
  'session.info',
  'session.input',
  'session.output',
  'session.viewport',
];

export function parseRequest(raw: string): IpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IpcError(IpcErrorCodes.PARSE_ERROR, 'Malformed JSON: failed to parse request body');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new IpcError(IpcErrorCodes.INVALID_REQUEST, 'Request must be a JSON object');
  }

  const req = parsed as Record<string, unknown>;

  if (typeof req.id !== 'string' || req.id.length === 0) {
    throw new IpcError(
      IpcErrorCodes.INVALID_REQUEST,
      'Request must have a non-empty string "id" field'
    );
  }

  if (typeof req.method !== 'string' || !VALID_METHODS.includes(req.method as IpcMethod)) {
    const received = typeof req.method === 'string' ? req.method : typeof req.method;
    throw new IpcError(
      IpcErrorCodes.METHOD_NOT_FOUND,
      `Unknown method "${received}". Valid methods: ${VALID_METHODS.join(', ')}`
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
    if ((!inputParams.text || inputParams.text.length === 0) && !hasEnter) {
      throw new IpcError(
        IpcErrorCodes.INVALID_PARAMS,
        '"session.input" requires non-empty "text" or a submit action via "enter"'
      );
    }
    if (typeof inputParams.text !== 'string' && inputParams.text !== undefined) {
      throw new IpcError(IpcErrorCodes.INVALID_PARAMS, '"text" must be a string if provided');
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
  message: string
): IpcErrorResponse {
  return { id: id || 'unknown', type: 'error', error: { code, message } };
}

export function serializeResponse(response: IpcResponse): string {
  return JSON.stringify(response) + '\n';
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
