import {
  parseRequest,
  createSuccessResponse,
  createErrorResponse,
  serializeResponse,
  MAX_SESSION_INPUT_BYTES,
} from '../src/controller/protocol';
import { IpcError, IpcErrorCodes, IpcErrorReasons, IpcResponse } from '../src/types/controller';

function expectIpcError(fn: () => void, expectedCode: string, expectedReason?: string): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(IpcError);
  expect((err as IpcError).code).toBe(expectedCode);
  if (expectedReason) expect((err as IpcError).reason).toBe(expectedReason);
}

describe('parseRequest', () => {
  it('parses a valid ping request', () => {
    const req = parseRequest('{"id":"req-1","method":"ping"}');
    expect(req).toEqual({ id: 'req-1', method: 'ping', params: {} });
  });

  it('parses a valid session.info request with params', () => {
    const req = parseRequest(
      '{"id":"req-2","method":"session.info","params":{"sessionKey":"test_abc1"}}'
    );
    expect(req).toEqual({
      id: 'req-2',
      method: 'session.info',
      params: { sessionKey: 'test_abc1' },
    });
  });

  it('parses a valid session.input request', () => {
    const req = parseRequest(
      '{"id":"req-3","method":"session.input","params":{"text":"hello","enter":true}}'
    );
    expect(req).toEqual({
      id: 'req-3',
      method: 'session.input',
      params: { text: 'hello', enter: true },
    });
  });

  it('parses session.input without optional enter field', () => {
    const req = parseRequest('{"id":"req-4","method":"session.input","params":{"text":"world"}}');
    expect(req).toEqual({
      id: 'req-4',
      method: 'session.input',
      params: { text: 'world' },
    });
  });

  it('parses a valid session.output request', () => {
    const req = parseRequest('{"id":"req-out","method":"session.output"}');
    expect(req).toEqual({ id: 'req-out', method: 'session.output', params: {} });
  });

  it('parses a valid session.viewport request', () => {
    const req = parseRequest('{"id":"req-vp","method":"session.viewport"}');
    expect(req).toEqual({ id: 'req-vp', method: 'session.viewport', params: {} });
  });

  it('parses a valid session.interrupt request', () => {
    const req = parseRequest('{"id":"req-int","method":"session.interrupt"}');
    expect(req).toEqual({ id: 'req-int', method: 'session.interrupt', params: {} });
  });

  it('defaults params to empty object when omitted', () => {
    const req = parseRequest('{"id":"req-5","method":"ping"}');
    expect(req.params).toEqual({});
  });

  it('defaults params to empty object when params is not an object', () => {
    const req = parseRequest('{"id":"req-6","method":"ping","params":"invalid"}');
    expect(req.params).toEqual({});
  });

  it('rejects malformed JSON with PARSE_ERROR', () => {
    expectIpcError(
      () => parseRequest('not json'),
      IpcErrorCodes.PARSE_ERROR,
      IpcErrorReasons.PROTOCOL_PARSE_ERROR
    );
  });

  it('rejects non-object JSON with INVALID_REQUEST', () => {
    expectIpcError(() => parseRequest('"string"'), IpcErrorCodes.INVALID_REQUEST);
  });

  it('rejects null JSON with INVALID_REQUEST', () => {
    expectIpcError(() => parseRequest('null'), IpcErrorCodes.INVALID_REQUEST);
  });

  it('rejects missing id field with INVALID_REQUEST', () => {
    expectIpcError(() => parseRequest('{"method":"ping"}'), IpcErrorCodes.INVALID_REQUEST);
  });

  it('rejects empty string id with INVALID_REQUEST', () => {
    expectIpcError(() => parseRequest('{"id":"","method":"ping"}'), IpcErrorCodes.INVALID_REQUEST);
  });

  it('rejects unknown method with METHOD_NOT_FOUND', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"unknown"}'),
      IpcErrorCodes.METHOD_NOT_FOUND
    );
  });

  it('includes valid methods in METHOD_NOT_FOUND error message', () => {
    let err: unknown;
    try {
      parseRequest('{"id":"r1","method":"bogus"}');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IpcError);
    const msg = (err as IpcError).message;
    expect(msg).toMatch(/ping/);
    expect(msg).toMatch(/session\.info/);
    expect(msg).toMatch(/session\.input/);
    expect(msg).toMatch(/session\.output/);
    expect(msg).toMatch(/session\.viewport/);
    expect(msg).toMatch(/session\.interrupt/);
  });

  it('rejects session.input without text with INVALID_PARAMS', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.input","params":{}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
  });

  it('rejects session.input with empty text with INVALID_PARAMS', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.input","params":{"text":""}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
  });

  it('rejects session.input with non-string text with INVALID_PARAMS', () => {
    expectIpcError(
      () => parseRequest('{"id":"r1","method":"session.input","params":{"text":123}}'),
      IpcErrorCodes.INVALID_PARAMS
    );
  });

  it('classifies normalized-empty input', () => {
    const raw = JSON.stringify({
      id: 'r1',
      method: 'session.input',
      params: { text: ' \t ' },
    });
    expectIpcError(
      () => parseRequest(raw),
      IpcErrorCodes.INVALID_PARAMS,
      IpcErrorReasons.EMPTY_AFTER_NORMALIZATION
    );
  });

  it('classifies unsupported control characters', () => {
    const raw = JSON.stringify({
      id: 'r1',
      method: 'session.input',
      params: { text: 'hello\u0000world' },
    });
    expectIpcError(
      () => parseRequest(raw),
      IpcErrorCodes.INVALID_PARAMS,
      IpcErrorReasons.UNSUPPORTED_CHARS
    );
  });

  it('classifies invalid Unicode surrogate sequences', () => {
    const raw = JSON.stringify({
      id: 'r1',
      method: 'session.input',
      params: { text: '\ud800' },
    });
    expectIpcError(
      () => parseRequest(raw),
      IpcErrorCodes.INVALID_PARAMS,
      IpcErrorReasons.INVALID_ENCODING
    );
  });

  it('classifies oversized input before it reaches the PTY', () => {
    const raw = JSON.stringify({
      id: 'r1',
      method: 'session.input',
      params: { text: 'x'.repeat(MAX_SESSION_INPUT_BYTES + 1) },
    });
    expectIpcError(() => parseRequest(raw), IpcErrorCodes.INVALID_PARAMS, IpcErrorReasons.TOO_LONG);
  });

  it('rejects non-string method with METHOD_NOT_FOUND', () => {
    expectIpcError(() => parseRequest('{"id":"r1","method":42}'), IpcErrorCodes.METHOD_NOT_FOUND);
  });
});

describe('createSuccessResponse', () => {
  it('creates a success response with data', () => {
    const res = createSuccessResponse('req-1', { pong: true });
    expect(res).toEqual({
      id: 'req-1',
      type: 'success',
      data: { pong: true },
    });
  });

  it('creates a success response with primitive data', () => {
    const res = createSuccessResponse('req-2', 'ok');
    if (res.type === 'success') {
      expect(res.data).toBe('ok');
    } else {
      throw new Error('Expected success response');
    }
  });
});

describe('createErrorResponse', () => {
  it('creates an error response with code and message', () => {
    const res = createErrorResponse('req-1', 'BAD_THING', 'Something went wrong');
    expect(res).toEqual({
      id: 'req-1',
      type: 'error',
      error: { code: 'BAD_THING', message: 'Something went wrong' },
    });
  });

  it('includes a machine-readable reason when supplied', () => {
    const res = createErrorResponse(
      'req-2',
      IpcErrorCodes.INVALID_PARAMS,
      'message is too long',
      IpcErrorReasons.TOO_LONG
    );
    expect(res.error.reason).toBe('too_long');
  });

  it('uses "unknown" as id when null id is given', () => {
    const res = createErrorResponse(null, 'ERR', 'msg');
    expect(res.id).toBe('unknown');
  });
});

describe('serializeResponse', () => {
  it('serializes a success response to JSON line', () => {
    const res: IpcResponse = {
      id: 'r1',
      type: 'success',
      data: { ok: true },
    };
    expect(serializeResponse(res)).toBe('{"id":"r1","type":"success","data":{"ok":true}}\n');
  });

  it('serializes error responses', () => {
    const res: IpcResponse = {
      id: 'r1',
      type: 'error',
      error: { code: 'ERR', message: 'fail' },
    };
    expect(serializeResponse(res)).toBe(
      '{"id":"r1","type":"error","error":{"code":"ERR","message":"fail"}}\n'
    );
  });
});

describe('IpcError', () => {
  it('is an instance of Error and IpcError', () => {
    const err = new IpcError(IpcErrorCodes.PARSE_ERROR, 'bad json');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IpcError');
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.message).toBe('bad json');
  });
});
