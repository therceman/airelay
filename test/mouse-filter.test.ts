import fs from 'fs';
import net from 'net';
import path from 'path';
import {
  MOUSE_TRACKING_RESET,
  MouseTrackingFilter,
  stripMouseTrackingSequences,
} from '../src/runtime/mouse-filter';
import { runCommand } from '../src/commands/run';
import { readLines } from '../src/controller/protocol';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

const MOUSE_MODES = ['9', '1000', '1002', '1003', '1005', '1006', '1007', '1015', '1016'];

describe('MouseTrackingFilter', () => {
  it('strips every mouse-tracking DECSET/DECRST mode', () => {
    for (const mode of MOUSE_MODES) {
      for (const suffix of ['h', 'l']) {
        const filter = new MouseTrackingFilter();
        expect(filter.feed(`A\x1b[?${mode}${suffix}B`)).toBe('AB');
      }
    }
  });

  it('preserves non-mouse private modes', () => {
    const filter = new MouseTrackingFilter();
    const chunk = 'x\x1b[?1049h\x1b[?2004h\x1b[?25l\x1b[?2026h\x1b[?1004hy';
    expect(filter.feed(chunk)).toBe(chunk);
  });

  it('strips a sequence split across chunks', () => {
    const filter = new MouseTrackingFilter();
    expect(filter.feed('text\x1b[?10')).toBe('text');
    expect(filter.feed('03hmore')).toBe('more');
  });

  it('strips combined all-mouse parameter lists', () => {
    const filter = new MouseTrackingFilter();
    expect(filter.feed('a\x1b[?1000;1002;1003;1006hb')).toBe('ab');
  });

  it('preserves mixed mouse/non-mouse parameter lists', () => {
    const filter = new MouseTrackingFilter();
    expect(filter.feed('a\x1b[?1000;1049hb')).toBe('a\x1b[?1000;1049hb');
  });

  it('passes through ordinary text, colors and cursor movement', () => {
    const filter = new MouseTrackingFilter();
    const chunk = 'plain\x1b[38;5;196mred\x1b[0m\x1b[2;3Hend';
    expect(filter.feed(chunk)).toBe(chunk);
  });

  it('flushes a dangling partial escape at end of stream', () => {
    const filter = new MouseTrackingFilter();
    expect(filter.feed('tail\x1b')).toBe('tail');
    expect(filter.flush()).toBe('\x1b');
  });

  it('emits a held non-mouse sequence once the next chunk disambiguates', () => {
    const filter = new MouseTrackingFilter();
    expect(filter.feed('\x1b[?10')).toBe('');
    expect(filter.feed('49h')).toBe('\x1b[?1049h');
  });
});

describe('stripMouseTrackingSequences', () => {
  it('strips mouse modes replayed by a screen serialization in one shot', () => {
    // The xterm serializer re-emits the harness's DECSET modes, e.g.
    // "...text\x1b[?2004h\x1b[?1003h" — the mouse mode must go, the rest stay.
    const serialized = 'row\x1b[?2004h\x1b[?1003h\x1b[?1h';
    expect(stripMouseTrackingSequences(serialized)).toBe('row\x1b[?2004h\x1b[?1h');
  });

  it('handles combined mode lists and disables', () => {
    expect(stripMouseTrackingSequences('a\x1b[?9;1003lb')).toBe('ab');
    expect(stripMouseTrackingSequences('a\x1b[?1003;1049lb')).toBe('a\x1b[?1003;1049lb');
  });
});

describe('MOUSE_TRACKING_RESET', () => {
  it('disables every tracked mouse mode', () => {
    for (const mode of MOUSE_MODES) {
      expect(MOUSE_TRACKING_RESET).toContain(`\x1b[?${mode}l`);
    }
    expect(MOUSE_TRACKING_RESET).not.toMatch(/\?10[04][49]l|\?1049l|\?2004l/);
  });
});

function writeHarness(name: string, body: string): string {
  const harnessPath = path.join(testEnv.testDir, name);
  fs.writeFileSync(harnessPath, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(harnessPath, 0o755);
  return harnessPath;
}

function writeConfig(profileName: string, executable: string, mousePassthrough = false): void {
  fs.writeFileSync(
    testEnv.configPath,
    JSON.stringify({
      version: 1,
      settings: { hibernateAfter: 'off', harnessSelfUpdate: true, mousePassthrough },
      profiles: { [profileName]: { executable } },
    })
  );
}

const MOUSE_BURST =
  'X\\x1b[?9h\\x1b[?1000h\\x1b[?1002h\\x1b[?1003h\\x1b[?1005h\\x1b[?1006h\\x1b[?1007h\\x1b[?1015h\\x1b[?1016hY';
const MOUSE_ENABLE_PATTERN = /\?10(?:00|02|03|05|06|07|15|16)h|\?9h/;

async function waitForEndpoint(get: () => string): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const endpoint = get();
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for controller endpoint');
}

describe('terminal-bound mouse mode stripping', () => {
  it('strips mouse modes from foreground output', async () => {
    const harnessPath = writeHarness(
      'mouse-foreground',
      `process.stdout.write('${MOUSE_BURST}');
setTimeout(() => process.exit(0), 300);`
    );
    writeConfig('mousefg', harnessPath, false);

    const chunks: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    try {
      const exit = await runCommand('mousefg', [], { usePty: true, sessionKey: 'mouse_fg' });
      expect(exit).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const foreground = chunks.join('');
    expect(foreground).toContain('XY');
    expect(foreground).not.toMatch(MOUSE_ENABLE_PATTERN);
  }, 15000);

  it('passes mouse modes through when settings.mousePassthrough is true', async () => {
    const harnessPath = writeHarness(
      'mouse-passthrough',
      `process.stdout.write('${MOUSE_BURST}');
setTimeout(() => process.exit(0), 300);`
    );
    writeConfig('mousept', harnessPath, true);

    const chunks: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    try {
      const exit = await runCommand('mousept', [], { usePty: true, sessionKey: 'mouse_pt' });
      expect(exit).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    expect(chunks.join('')).toContain('\x1b[?1003h');
  }, 15000);

  it('strips mouse modes from detached attach stream frames', async () => {
    const harnessPath = writeHarness(
      'mouse-attached',
      `process.stdout.write('${MOUSE_BURST}DONE');
setTimeout(() => process.exit(0), 1500);`
    );
    writeConfig('mouseattach', harnessPath, false);

    let endpoint = '';
    const runPromise = runCommand('mouseattach', [], {
      usePty: true,
      detached: true,
      sessionKey: 'mouse_attach',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });

    const socketEndpoint = await waitForEndpoint(() => endpoint);
    const { streamed, firstChunk } = await new Promise<{
      streamed: string;
      firstChunk: string;
    }>((resolve) => {
      const socket = net.createConnection(socketEndpoint);
      let buffer = '';
      let collected = '';
      let first = '';
      const finish = setTimeout(() => {
        socket.destroy();
        resolve({ streamed: collected, firstChunk: first });
      }, 700);
      socket.on('connect', () => {
        socket.write(JSON.stringify({ id: 'a1', method: 'session.attach' }) + '\n');
      });
      socket.on('data', (chunk: Buffer) => {
        buffer = readLines(buffer + chunk.toString(), (line) => {
          try {
            const msg = JSON.parse(line) as { type?: string; data?: { chunk?: string } };
            if (msg.type === 'stream' && typeof msg.data?.chunk === 'string') {
              if (!first) first = msg.data.chunk;
              collected += msg.data.chunk;
            }
          } catch {
            // Ignore malformed frames
          }
        });
      });
      socket.on('error', () => {
        clearTimeout(finish);
        resolve({ streamed: collected, firstChunk: first });
      });
    });

    // The attach stream opens with an explicit tracking reset so a terminal
    // still in mouse-report mode (leaked by an earlier/crashed session) is
    // cleared before any replayed content arrives.
    expect(firstChunk).toBe(MOUSE_TRACKING_RESET);
    expect(streamed).toContain('XYDONE');
    expect(streamed).not.toMatch(MOUSE_ENABLE_PATTERN);
    await expect(runPromise).resolves.toBe(0);
  }, 15000);
});
