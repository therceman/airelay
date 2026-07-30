import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionController } from '../src/controller';
import { promptCommand } from '../src/commands/prompt';
import { addSession, removeSessionByKey, findSessionByKey } from '../src/commands/sessions';

import { fetchSessionViewport } from '../src/commands/session-viewport';

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
  delete process.env.AIRELAY_SESSION_KEY;
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

  it('session.viewport returns error for unreachable endpoint', async () => {
    const result = await fetchSessionViewport('/nonexistent/socket.sock');
    expect(result.lines).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('lastOutputChangeAt updates on feedOutput', async () => {
    const controller = new SessionController('activity_test');

    const before = controller.lastOutputChangeAtForTest();
    await new Promise((r) => setTimeout(r, 5));
    controller.feedOutput('new output\n');
    const after = controller.lastOutputChangeAtForTest();

    expect(after).toBeGreaterThan(before);
  });

  it('lastOutputChangeAt does not update on empty feed', async () => {
    const controller = new SessionController('activity_empty_test');
    const before = controller.lastOutputChangeAtForTest();
    controller.feedOutput('');
    const after = controller.lastOutputChangeAtForTest();
    expect(after).toBe(before);
  });

  it('session.viewport IPC returns visible lines', async () => {
    const sessionKey = 'e2e_vp_ipc';
    const controller = new SessionController(sessionKey);

    controller.feedOutput('alpha\nbravo\ncharlie\n');
    await controller.flushViewport();

    controller.onRequest(async () => ({ handled: false }));
    await controller.start();

    addSession('e2e-profile', 'e2e_vp_ipc_ses', undefined, sessionKey, controller.endpointPath);

    const result = await fetchSessionViewport(controller.endpointPath);
    expect(result.error).toBeUndefined();
    expect(result.lines).toContain('alpha');
    expect(result.lines).toContain('bravo');
    expect(result.lines).toContain('charlie');

    await controller.stop();
    removeSessionByKey(sessionKey);
  });

  it('viewport reflects CR-overwritten lines correctly', async () => {
    const controller = new SessionController('vp_cr_test');

    // Simulate a progress line overwrite: application writes status, CR, new shorter status
    // xterm treats \r as carriage return (cursor to col 0, does NOT clear line)
    controller.feedOutput('Progress: step 1\n');
    controller.feedOutput('Progress: step 2...');
    controller.feedOutput('\rProgress: DONE!\n');
    controller.feedOutput('line 3\n');
    await controller.flushViewport();

    const lines = controller.getViewportSnapshot();
    // "Progress: step 2..." was overwritten in place — must not appear as its own line
    expect(lines).not.toContain('Progress: step 2...');
    // The visible line shows "Progress: DONE!" + remaining chars from before
    expect(lines[0]).toBe('Progress: step 1');
    expect(lines[1]).toContain('Progress: DONE!');
    expect(lines[2]).toBe('line 3');
  });

  it('scrolled-off lines do not appear in viewport', async () => {
    const controller = new SessionController('vp_scroll_test');

    for (let i = 0; i < 50; i++) {
      controller.feedOutput(`line ${i}\n`);
    }
    await controller.flushViewport();

    const lines = controller.getViewportSnapshot();
    // xterm uses 30 rows, one for cursor line — 29 non-empty visible
    expect(lines.length).toBe(29);
    expect(lines[0]).toBe('line 22');
    expect(lines).not.toContain('line 0');
    expect(lines).not.toContain('line 21');
    expect(lines).toContain('line 49');
  });

  it('snapshot window retains recently-visible term after it is replaced', async () => {
    const controller = new SessionController('vp_snap_retain');

    // Show a term briefly
    controller.feedOutput('pong\n');
    await controller.flushViewport();
    controller.takeSnapshot();

    // Replace with different content
    controller.feedOutput('new content\n');
    await controller.flushViewport();

    // The snapshot window should still contain 'pong' from the earlier snapshot
    const windowed = controller.getViewportSnapshot();
    expect(windowed).toContain('pong');
    expect(windowed).toContain('new content');
  });

  it('snapshot window does not retain term that never appeared', async () => {
    const controller = new SessionController('vp_snap_no_match');

    controller.feedOutput('visible line\n');
    await controller.flushViewport();
    controller.takeSnapshot();

    const windowed = controller.getViewportSnapshot();
    expect(windowed).not.toContain('ghost_output');
  });

  it('snapshot window retention cap works', async () => {
    const controller = new SessionController('vp_snap_cap');

    // Feed 150 unique lines, snapshotted one by one
    for (let i = 0; i < 150; i++) {
      controller.feedOutput(`unique_line_${i}\n`);
      await controller.flushViewport();
      controller.takeSnapshot();
    }

    const windowed = controller.getViewportSnapshot();
    expect(windowed.length).toBeLessThanOrEqual(120);
    // Oldest entries should have been evicted
    const oldEntries = windowed.filter(
      (l) => l.startsWith('unique_line_') && parseInt(l.split('_')[2], 10) < 30
    );
    expect(oldEntries.length).toBe(0);
  });
});
