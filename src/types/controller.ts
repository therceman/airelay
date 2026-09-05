import type { DeliveryStatus } from '../runtime/delivery';
import type { RuntimeBuffers, RuntimeMemory } from '../runtime/identity';

export type IpcMethod =
  | 'ping'
  | 'session.info'
  | 'session.input'
  | 'session.output'
  | 'session.viewport'
  | 'session.interrupt'
  | 'session.attach'
  | 'session.detach'
  | 'session.input.raw'
  | 'session.resize';

export interface IpcRequest {
  id: string;
  method: IpcMethod;
  params?: Record<string, unknown>;
}

export interface SessionInfoParams {
  sessionKey?: string;
}

export interface SessionInputParams {
  text: string;
  /** Stable client-generated identity for transport retry/idempotency. */
  deliveryId?: string;
  /**
   * Submit byte/sequence to append after text.
   * - "\r" (0x0D) = Enter (default for all harnesses)
   * - false or absent = no submit
   */
  enter?: string | boolean;

  /**
   * Delay in ms between writing text and writing the submit sequence.
   * Needed for TUI apps that need to process text before receiving Enter.
   * Use 0 or omit for no delay.
   */
  submitDelayMs?: number;
}

/** Narrow raw PTY input operation for the attach client (no submit/Enter logic). */
export interface SessionRawInputParams {
  data: string;
}

export interface SessionResizeParams {
  cols: number;
  rows: number;
}

export interface IpcSuccessResponse<T = unknown> {
  id: string;
  type: 'success';
  data: T;
}

export interface IpcErrorResponse {
  id: string;
  type: 'error';
  error: {
    code: string;
    message: string;
    /** Stable machine-readable classification for callers and external controllers. */
    reason?: IpcErrorReason;
  };
}

export type IpcResponse = IpcSuccessResponse | IpcErrorResponse;

/**
 * Server→client notification carrying a raw PTY output chunk for the attach
 * stream. It is not a request and is never parsed by `parseRequest`; the
 * attach client routes it by its `type` field.
 */
export interface IpcStreamFrame {
  type: 'stream';
  data: {
    /** Raw terminal bytes (ANSI/control/UTF-8) as delivered by the PTY. */
    chunk: string;
  };
}

export const IpcErrorCodes = {
  PARSE_ERROR: 'PARSE_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const IpcErrorReasons = {
  TOO_LONG: 'too_long',
  UNSUPPORTED_CHARS: 'unsupported_chars',
  INVALID_ENCODING: 'invalid_encoding',
  EMPTY_AFTER_NORMALIZATION: 'empty_after_normalization',
  PROTOCOL_PARSE_ERROR: 'protocol_parse_error',
  INVALID_TYPE: 'invalid_type',
  INVALID_REQUEST: 'invalid_request',
  UNSUPPORTED_METHOD: 'unsupported_method',
  INVALID_PARAMS: 'invalid_params',
  NOT_PROMPTABLE: 'not_promptable',
  CONTROLLER_UNAVAILABLE: 'controller_unavailable',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type IpcErrorReason = (typeof IpcErrorReasons)[keyof typeof IpcErrorReasons];

export type IpcErrorCode = (typeof IpcErrorCodes)[keyof typeof IpcErrorCodes];

export class IpcError extends Error {
  constructor(
    public code: IpcErrorCode,
    message: string,
    public reason?: IpcErrorReason
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

export interface PingData {
  pong: true;
}

export interface SessionInfoData {
  sessionKey: string;
  active: boolean;
  /** Semantic harness availability state used by external watchers. */
  state?: 'busy' | 'idle';
  airelayVersion: string;
  controllerProtocolVersion: number;
  startedAt: number;
  lastOutputChangeAt?: number;
  delivery?: DeliveryStatus;
  /** Number of currently attached viewport clients (raw input sockets). */
  attached?: number;
  memory?: RuntimeMemory;
  buffers?: RuntimeBuffers;
}

export interface SessionAttachData {
  /** Number of attached clients after this attach/detach operation. */
  attached: number;
}
