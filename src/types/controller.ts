export type IpcMethod =
  | 'ping'
  | 'session.info'
  | 'session.input'
  | 'session.output'
  | 'session.viewport';

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
  };
}

export type IpcResponse = IpcSuccessResponse | IpcErrorResponse;

export const IpcErrorCodes = {
  PARSE_ERROR: 'PARSE_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type IpcErrorCode = (typeof IpcErrorCodes)[keyof typeof IpcErrorCodes];

export class IpcError extends Error {
  constructor(
    public code: IpcErrorCode,
    message: string
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
  airelayVersion: string;
  controllerProtocolVersion: number;
  startedAt: number;
}
