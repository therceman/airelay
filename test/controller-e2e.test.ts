import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionController } from '../src/controller';
import { promptCommand } from '../src/commands/prompt';
import { addSession, removeSessionByKey, findSessionByKey } from '../src/commands/sessions';

const testDir = path.join(os.tmpdir(), 'airelay-e2e-test-' + process.pid + '-' + Date.now());
const testSessionsPath = path.join(testDir, 'sessions.json');
const testSocketsDir = path.join(testDir, 'sockets');

beforeAll(() => {
  fs.mkdirSync(testSocketsDir, { recursive: true });
  process.env.AIRELAY_SESSIONS = testSessionsPath;
  process.env.AIRELAY_SOCKETS_DIR = testSocketsDir;
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.AIRELAY_SESSIONS;
  delete process.env.AIRELAY_SOCKETS_DIR;
});

let senderKey: string;

beforeEach(() => {
  if (fs.existsSync(testSessionsPath)) {
    fs.unlinkSync(testSessionsPath);
  }
  const files = fs.readdirSync(testSocketsDir);
  for (const f of files) {
    fs.unlinkSync(path.join(testSocketsDir, f));
  }
  senderKey = 'e2e_sender';
  process.env.AIRELAY_SESSION_KEY = senderKey;
});

describe('controller E2E: real IPC socket flow', () => {
  it('prompt delivers input to controller handler via real socket', async () => {
    const sessionKey = 'e2e_test_key';
    const controller = new SessionController(sessionKey);

    let deliveredText = '';
    let deliveredEnter = false;

    controller.onRequest(async (req) => {
      if (req.method === 'session.input') {
        const params = req.params as { text?: string; enter?: boolean };
        deliveredText = params.text || '';
        deliveredEnter = params.enter !== false;
        return { received: true };
      }
      if (req.method === 'session.info') {
        return { sessionKey, active: true };
      }
      return { handled: false };
    });

    await controller.start();

    // Pre-save session record so promptCommand can find it
    addSession('e2e-profile', 'e2e_ses_id', undefined, sessionKey, controller.endpointPath);

    // Verify session is findable
    const found = findSessionByKey(sessionKey);
    expect(found).not.toBeNull();
    expect(found!.session.controllerEndpoint).toBe(controller.endpointPath);

    // Use promptCommand to send input via real IPC
    const exitCode = await promptCommand(sessionKey, 'Hello E2E', { enter: true });

    expect(exitCode).toBe(0);
    expect(deliveredText).toBe(`[from=${senderKey}] Hello E2E`);
    expect(deliveredEnter).toBe(true);

    await controller.stop();
    removeSessionByKey(sessionKey);
  });

  it('prompt uses persisted controllerEndpoint from session record', async () => {
    const sessionKey = 'e2e_endpoint_test';
    const controller = new SessionController(sessionKey);

    let delivered = false;
    controller.onRequest(async (req) => {
      if (req.method === 'session.input') {
        delivered = true;
        return { received: true };
      }
      return { handled: false };
    });

    await controller.start();

    // Save session with explicit controllerEndpoint
    addSession('e2e-profile', 'e2e_endpoint_ses', undefined, sessionKey, controller.endpointPath);

    const exitCode = await promptCommand(sessionKey, 'test endpoint', { enter: false });

    expect(exitCode).toBe(0);
    expect(delivered).toBe(true);

    await controller.stop();
    removeSessionByKey(sessionKey);
  });

  it('prompt returns offline error when controller is stopped', async () => {
    const sessionKey = 'e2e_offline_test';
    const controller = new SessionController(sessionKey);

    controller.onRequest(async () => ({ handled: false }));
    await controller.start();

    addSession('e2e-profile', 'e2e_offline_ses', undefined, sessionKey, controller.endpointPath);

    // Stop controller before prompting
    await controller.stop();

    const exitCode = await promptCommand(sessionKey, 'should fail');

    expect(exitCode).toBe(1);

    removeSessionByKey(sessionKey);
  });

  it('fallback to derived endpoint when controllerEndpoint is missing', async () => {
    const sessionKey = 'e2e_fallback_key';
    const controller = new SessionController(sessionKey);

    let delivered = false;
    controller.onRequest(async (req) => {
      if (req.method === 'session.input') {
        delivered = true;
        return { received: true };
      }
      return { handled: false };
    });

    await controller.start();

    // Save session WITHOUT controllerEndpoint — prompt should derive path from sessionKey
    addSession('e2e-profile', 'e2e_fallback_ses', undefined, sessionKey);

    const exitCode = await promptCommand(sessionKey, 'fallback test');

    expect(exitCode).toBe(0);
    expect(delivered).toBe(true);

    await controller.stop();
    removeSessionByKey(sessionKey);
  });

  it('prompt sends text with Enter as carriage return (\\r) for PTY semantics', async () => {
    const sessionKey = 'e2e_enter_test';
    const controller = new SessionController(sessionKey);

    let capturedText = '';
    let capturedEnter = false;
    let handlerCalled = false;

    controller.onRequest(async (req) => {
      if (req.method === 'session.input') {
        handlerCalled = true;
        const params = req.params as { text?: string; enter?: boolean };
        capturedText = params.text || '';
        capturedEnter = params.enter !== false;
        // The controller handler in run.ts writes text + \r to the PTY
        // Simulate what would be written to the PTY:
        const ptyWrittenBytes = capturedText + (capturedEnter ? '\r' : '');
        return {
          received: true,
          text: capturedText,
          enter: capturedEnter,
          ptyWritten: ptyWrittenBytes,
          ptyWrittenHex: Buffer.from(ptyWrittenBytes).toString('hex'),
        };
      }
      return { handled: false };
    });

    await controller.start();

    addSession('e2e-profile', 'e2e_enter_ses', undefined, sessionKey, controller.endpointPath);

    const exitCode = await promptCommand(sessionKey, 'submit this', { enter: true });

    expect(exitCode).toBe(0);
    expect(handlerCalled).toBe(true);
    expect(capturedText).toBe(`[from=${senderKey}] submit this`);
    expect(capturedEnter).toBe(true);

    // Verify the bytes that would be written to the PTY: text + \r (0x0d)
    const expectedBytes = capturedText + (capturedEnter ? '\r' : '');
    expect(expectedBytes.endsWith('\r')).toBe(true);
    expect(Buffer.from(expectedBytes).toString('hex')).toMatch(/0d$/);

    await controller.stop();
    removeSessionByKey(sessionKey);
  });
});
