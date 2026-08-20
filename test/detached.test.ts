import net from 'net';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { useTestEnv, createTestConfig } from './test-utils';
import {
  startDetachedCommand,
  detachedListCommand,
  detachedPruneCommand,
} from '../src/commands/detached';
import {
  getDetachedEntry,
  listDetachedEntries,
  addDetachedEntry,
  findDetachedBySessionKey,
  pruneDetachedEntries,
  isEntryReachable,
} from '../src/runtime/detached-registry';
import { sendControllerRequest } from '../src/commands/session-ipc';
import { loadSessions } from '../src/commands/sessions';
import { listPIDs, cleanupOrphanedPIDs } from '../src/utils/pid';
import { runCommand } from '../src/commands/run';
import { promptCommand } from '../src/commands/prompt';
import { parseArgs } from '../src/cli';
import { attachCommand } from '../src/commands/attach';
import { isProcessAlive } from '../src/runtime/detached-registry';

jest.setTimeout(120000);

const ROOT = path.join(__dirname, '..');
const HARNESS_SCRIPT = `process.stdin.setRawMode(true);
process.stdin.on('data',function(d){
  var s=d.toString();
  if(s.indexOf('SHUT')>=0){process.stdout.write('BYE');setTimeout(function(){process.exit(0);},50);return;}
  if(s.indexOf('\\u0003')>=0){process.stdout.write('BYE');setTimeout(function(){process.exit(0);},50);return;}
  if(s.indexOf('SIZE')>=0){process.stdout.write('SIZE:'+process.stdout.columns+','+process.stdout.rows+'\\n');return;}
  if(s.indexOf('ANSI')>=0){process.stdout.write('\\u001b[31mANSI-OUT\\u001b[0m');return;}
  process.stdout.write('E:'+JSON.stringify(s)+'\\n');
});
process.stdout.write('READY\\n');`;

let built = false;
function ensureBuilt(): void {
  if (built) return;
  built = true;
  execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function viewportContains(
  endpoint: string,
  text: string,
  timeoutMs = 5000
): Promise<boolean> {
  return waitFor(async () => {
    const res = await sendControllerRequest(endpoint, {
      id: `vp-${Math.random().toString(36).slice(2)}`,
      method: 'session.viewport',
    });
    const lines =
      ((res.data as { lines?: string[] } | undefined)?.lines as string[] | undefined) || [];
    return lines.some((l) => l.includes(text));
  }, timeoutMs);
}

function rawWrite(endpoint: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.once('error', reject);
    socket.connect(endpoint, () => {
      socket.write(
        JSON.stringify({
          id: `raw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          method: 'session.input.raw',
          params: { data },
        }) + '\n'
      );
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 80);
    });
  });
}

async function outputLines(endpoint: string): Promise<string[]> {
  const res = await sendControllerRequest(endpoint, {
    id: `out-${Math.random().toString(36).slice(2)}`,
    method: 'session.output',
  });
  return ((res.data as { lines?: string[] } | undefined)?.lines as string[] | undefined) || [];
}

class StdinSource {
  cb: ((chunk: Buffer) => void) | null = null;
  onData(cb: (chunk: Buffer) => void): void {
    this.cb = cb;
  }
  emit(chunk: Buffer | string): void {
    this.cb?.(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
  }
}
class ResizeSource {
  cb: ((cols: number, rows: number) => void) | null = null;
  onResize(cb: (cols: number, rows: number) => void): void {
    this.cb = cb;
  }
  emit(cols: number, rows: number): void {
    this.cb?.(cols, rows);
  }
}

interface Started {
  key: string;
  runtimePid: number;
  agentPid: number;
  controllerEndpoint: string;
  runtimeId: string;
  entryStartedAt: number;
}

async function startRuntime(key: string): Promise<Started> {
  await ensureBuilt();
  const code = await startDetachedCommand('detachpro', [], { key });
  expect(code).toBe(0);
  const entry = findDetachedBySessionKey(key);
  expect(entry).not.toBeNull();
  return {
    key,
    runtimePid: entry!.runtimePid,
    agentPid: entry!.agentPid,
    controllerEndpoint: entry!.controllerEndpoint,
    runtimeId: entry!.runtimeId,
    entryStartedAt: entry!.startedAt,
  };
}

describe('detached lifecycle, attach, prompt routing (E2E)', () => {
  const testEnv = useTestEnv();
  let runtime: Started;
  const started: { runtimePid: number; agentPid: number }[] = [];

  beforeAll(async () => {
    await ensureBuilt();
    createTestConfig(testEnv.configPath, {
      detachpro: { executable: 'node', description: 'harness', args: ['-e', HARNESS_SCRIPT] },
    });
    runtime = await startRuntime('e2e_runtime_1');
    started.push({ runtimePid: runtime.runtimePid, agentPid: runtime.agentPid });
  });

  afterAll(() => {
    for (const r of started) {
      try {
        process.kill(r.runtimePid, 'SIGKILL');
      } catch {
        // Already gone
      }
      try {
        process.kill(r.agentPid, 'SIGKILL');
      } catch {
        // Already gone
      }
    }
  });

  it('start --detached returns a structured registry entry with all fields', () => {
    const entry = getDetachedEntry(runtime.runtimeId);
    expect(entry).toBeDefined();
    expect(entry!.sessionKey).toBe('e2e_runtime_1');
    expect(entry!.runtimeId.length).toBeGreaterThan(0);
    expect(entry!.profile).toBe('detachpro');
    expect(entry!.cwd.length).toBeGreaterThan(0);
    expect(entry!.runtimePid).toBeGreaterThan(0);
    expect(entry!.agentPid).toBeGreaterThan(0);
    expect(entry!.controllerEndpoint).toContain('.sock');
    expect(entry!.startedAt).toBeGreaterThan(0);
  });

  it('the detached runtime survives the launcher and the controller is reachable', async () => {
    expect(isProcessAlive(runtime.runtimePid)).toBe(true);
    const reachable = await waitFor(async () => {
      const res = await sendControllerRequest(runtime.controllerEndpoint, {
        id: 'ping-1',
        method: 'ping',
      });
      return res.type === 'success';
    }, 5000);
    expect(reachable).toBe(true);
    expect(await viewportContains(runtime.controllerEndpoint, 'READY')).toBe(true);
  });

  it('attach does not create a second agent or PTY', async () => {
    const sessions = loadSessions();
    const profileSessions = sessions.detachpro || [];
    expect(profileSessions.filter((s) => s.sessionKey === runtime.key).length).toBe(1);
    const tracked = listPIDs().filter((p) => p.profile === 'detachpro');
    expect(tracked.length).toBe(1);

    const stdin = new StdinSource();
    const res = new ResizeSource();
    const attach = attachFor(runtime, stdin, res);
    await sleep(500);
    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);

    expect(getDetachedEntry(runtime.runtimeId)!.agentPid).toBe(runtime.agentPid);
    expect(listPIDs().filter((p) => p.profile === 'detachpro').length).toBe(1);
    expect(loadSessions().detachpro.filter((s) => s.sessionKey === runtime.key).length).toBe(1);
  });

  it('attach is stream-driven (no viewport polling) and disconnect survives', async () => {
    const stdin = new StdinSource();
    const res = new ResizeSource();
    const renderTimes: number[] = [];
    const attach = attachFor(runtime, stdin, res, {
      renderOverride: (chunk) => {
        renderTimes.push(Date.now());
        return chunk.length < 10000;
      },
    });
    await sleep(700);
    const settlesAt = Date.now();
    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);

    // Renders come only from the initial stream replay, never from a poller
    // ticking during idle.
    expect(renderTimes.length).toBeGreaterThanOrEqual(1);
    expect(renderTimes.every((t) => t < settlesAt)).toBe(true);

    expect(isProcessAlive(runtime.runtimePid)).toBe(true);
    await waitFor(async () => {
      const res2 = await sendControllerRequest(runtime.controllerEndpoint, {
        id: 'ping-a',
        method: 'ping',
      });
      return res2.type === 'success';
    }, 5000);
  });

  it('attach raw input is immediate, exact, and never appends Enter (not poll-gated)', async () => {
    await waitFor(() => viewportContains(runtime.controllerEndpoint, 'READY'), 5000);
    const before = await outputLines(runtime.controllerEndpoint);
    expect(before.filter((l) => l.includes('E:"')).length).toBe(0);

    const echo = 'QUICK-' + Date.now().toString(36);
    const sendStart = Date.now();
    await rawWrite(runtime.controllerEndpoint, echo);
    await viewportContains(runtime.controllerEndpoint, 'E:"' + echo + '"', 4000);
    const latency = Date.now() - sendStart;

    const afterRaw = await outputLines(runtime.controllerEndpoint);
    const echoes = afterRaw.filter((l) => l === 'E:"' + echo + '"');
    expect(echoes.length).toBe(1);
    expect(latency).toBeLessThan(4000);
  });

  it('attach raw input is forwarded by the AttachClient immediately without waiting for a poll', async () => {
    const stdin = new StdinSource();
    const res = new ResizeSource();
    const attach = attachFor(runtime, stdin, res);
    await sleep(400);
    // Feed raw input; the client must deliver it synchronously via IPC.
    const tBefore = Date.now();
    stdin.emit('SYNC');
    await viewportContains(runtime.controllerEndpoint, 'E:"SYNC"', 4000);
    const elapsed = Date.now() - tBefore;
    expect(elapsed).toBeLessThan(4000);
    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);
  });

  it('attach resize is immediate through dedicated IPC', async () => {
    const stdin = new StdinSource();
    const res = new ResizeSource();
    const attach = attachFor(runtime, stdin, res);
    await sleep(300);
    res.emit(132, 43);
    await rawWrite(runtime.controllerEndpoint, 'SIZE');
    await waitFor(() => viewportContains(runtime.controllerEndpoint, 'SIZE:132,43'), 4000);
    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);
  });

  it('attach stream relays raw ANSI escape/UTF-8 output bytes losslessly', async () => {
    const stdin = new StdinSource();
    const res = new ResizeSource();
    const renderedChunks: string[] = [];
    const attach = attachFor(runtime, stdin, res, {
      renderOverride: (chunk) => {
        renderedChunks.push(chunk);
        return true;
      },
    });
    await waitFor(() => getDetachedEntry(runtime.runtimeId)!.attachedClients === 1, 5000);

    await rawWrite(runtime.controllerEndpoint, 'ANSI');
    await waitFor(() => renderedChunks.join('').includes('ANSI-OUT'), 5000);
    const rendered = renderedChunks.join('');
    expect(rendered).toContain('\u001b[31mANSI-OUT\u001b[0m');

    await rawWrite(runtime.controllerEndpoint, 'HELLO-héllo—wörld');
    await waitFor(() => renderedChunks.join('').includes('E:"HELLO-héllo—wörld"'), 5000);
    expect(renderedChunks.join('')).toContain('HELLO-héllo—wörld');

    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);
  });

  it('prompt routing reaches the detached runtime exactly once', async () => {
    await ensureBuilt();
    const marker = 'PLQM-' + Math.random().toString(36).slice(2);
    const exit = await promptCommand(runtime.key, marker, { fastEnter: true });
    expect(exit).toBe(0);
    await waitFor(async () => {
      const lines = await outputLines(runtime.controllerEndpoint);
      return lines.some((l) => l.includes(marker));
    }, 6000);
    const lines = await outputLines(runtime.controllerEndpoint);
    expect(lines.filter((l) => l.includes(marker)).length).toBe(1);
  });

  it('client detach never stops the runtime and attached count returns to zero', async () => {
    const stdin = new StdinSource();
    const res = new ResizeSource();
    const attach = attachFor(runtime, stdin, res);
    await waitFor(() => getDetachedEntry(runtime.runtimeId)!.attachedClients === 1, 5000);
    stdin.emit(Buffer.from([0x04]));
    expect(await attach).toBe(0);
    await waitFor(() => getDetachedEntry(runtime.runtimeId)!.attachedClients === 0, 5000);
    expect(isProcessAlive(runtime.runtimePid)).toBe(true);
  });

  it('explicit runtime exit cleans the registry and session record', async () => {
    await rawWrite(runtime.controllerEndpoint, 'SHUT');
    const gone = await waitFor(() => getDetachedEntry(runtime.runtimeId) === undefined, 8000);
    expect(gone).toBe(true);
    const gone2 = await waitFor(
      () =>
        (loadSessions().detachpro || []).filter((s) => s.sessionKey === runtime.key).length === 0,
      8000
    );
    expect(gone2).toBe(true);
    const dead = await waitFor(() => !isProcessAlive(runtime.runtimePid), 8000);
    expect(dead).toBe(true);
  });

  it('Ctrl-C (0x03) is raw harness input: the attach client stays attached and the harness-exit boundary cleans state', async () => {
    const runtime2 = await startRuntime('e2e_runtime_ctrl_c');
    started.push({ runtimePid: runtime2.runtimePid, agentPid: runtime2.agentPid });

    const stdin = new StdinSource();
    const res = new ResizeSource();
    const attach = attachFor(runtime2, stdin, res);
    await waitFor(() => getDetachedEntry(runtime2.runtimeId)!.attachedClients === 1, 5000);
    // The detached runtime is still live and registered before the signal.
    expect(isProcessAlive(runtime2.runtimePid)).toBe(true);

    // Ctrl-C is forwarded to the harness, NOT an attach escape: the client
    // is not detached by 0x03 itself (asserted deterministically in the
    // AttachClient unit test). Here the harness interprets 0x03 as exit (like
    // opencode); the runtime then exits and the normal cleanup removes the
    // registry and session records — the attach client detaches only when the
    // controller goes away with the runtime, never because it swallowed the byte.
    stdin.emit(Buffer.from([0x03]));

    const gone = await waitFor(() => getDetachedEntry(runtime2.runtimeId) === undefined, 8000);
    expect(gone).toBe(true);
    const gone2 = await waitFor(
      () =>
        (loadSessions().detachpro || []).filter((s) => s.sessionKey === 'e2e_runtime_ctrl_c')
          .length === 0,
      8000
    );
    expect(gone2).toBe(true);
    const dead = await waitFor(() => !isProcessAlive(runtime2.runtimePid), 8000);
    expect(dead).toBe(true);
    const attachExit = await attach;
    expect(attachExit).toBe(1);
  });
});

function attachFor(
  runtime: Started,
  stdin: StdinSource,
  resize: ResizeSource,
  extra?: { renderOverride?: (chunk: string) => boolean }
): Promise<number> {
  return attachCommand(runtime.key, {
    stdinSource: stdin,
    resizeSource: resize,
    renderOverride: extra?.renderOverride ?? (() => true),
  });
}

describe('detached registry / prune / cleanup isolation', () => {
  const testEnv = useTestEnv();
  let runtime: Started;
  const started: { runtimePid: number; agentPid: number }[] = [];

  beforeAll(async () => {
    await ensureBuilt();
    createTestConfig(testEnv.configPath, {
      detachpro: { executable: 'node', description: 'harness', args: ['-e', HARNESS_SCRIPT] },
      exitpro: { executable: 'node', args: ['-e', 'process.exit(0)'] },
    });
    runtime = await startRuntime('prune_runtime_1');
    started.push({ runtimePid: runtime.runtimePid, agentPid: runtime.agentPid });
  });

  afterAll(() => {
    for (const r of started) {
      try {
        process.kill(r.runtimePid, 'SIGKILL');
      } catch {
        // Already gone
      }
      try {
        process.kill(r.agentPid, 'SIGKILL');
      } catch {
        // Already gone
      }
    }
  });

  it('detached --prune removes confirmed stale entries and never touches live or PID-reused ones', async () => {
    const staleId = 'stale-' + Date.now();
    const recycledId = 'recycled-' + Date.now();
    addDetachedEntry({
      runtimeId: staleId,
      sessionKey: 'stale_key',
      profile: 'detachpro',
      cwd: testEnv.testDir,
      runtimePid: 99999999,
      agentPid: 99999998,
      controllerEndpoint: path.join(testEnv.socketsDir, 'missing-' + staleId + '.sock'),
      startedAt: Date.now() - 1000,
      attachedClients: 0,
    });
    // PID-reuse protection: PID is alive (this test process) but controller is gone.
    addDetachedEntry({
      runtimeId: recycledId,
      sessionKey: 'recycled_key',
      profile: 'detachpro',
      cwd: testEnv.testDir,
      runtimePid: process.pid,
      agentPid: process.ppid,
      controllerEndpoint: path.join(testEnv.socketsDir, 'missing-' + recycledId + '.sock'),
      startedAt: Date.now() - 2000,
      attachedClients: 0,
    });

    const removed = await pruneDetachedEntries();
    expect(removed).toBe(1);

    expect(getDetachedEntry(staleId)).toBeUndefined();
    expect(getDetachedEntry(recycledId)).toBeDefined();
    expect(getDetachedEntry(runtime.runtimeId)).toBeDefined();
  });

  it('detached --prune command output and list fields are complete', async () => {
    const logs: string[] = [];
    const spy = jest
      .spyOn(console, 'log')
      .mockImplementation((...a: unknown[]) => logs.push(a.join(' ')));
    await detachedPruneCommand();
    expect(logs.some((l) => l.includes('No stale')) || logs.some((l) => l.includes('Pruned'))).toBe(
      true
    );
    spy.mockRestore();

    const jsonLogs: string[] = [];
    const jsonSpy = jest
      .spyOn(console, 'log')
      .mockImplementation((...a: unknown[]) => jsonLogs.push(a.join(' ')));
    await detachedListCommand({ json: true });
    jsonSpy.mockRestore();

    const parsed = JSON.parse(jsonLogs.join('\n')) as Record<string, unknown>[];
    const mine = parsed.find((r) => (r as { sessionKey?: string }).sessionKey === runtime.key);
    expect(mine).toBeDefined();
    const m = mine as Record<string, unknown>;
    expect(m.runtimeId).toBeDefined();
    expect(m.profile).toBe('detachpro');
    expect(m.cwd).toEqual(expect.any(String));
    expect((m.cwd as string).length).toBeGreaterThan(0);
    expect(m.runtimePid).toBe(runtime.runtimePid);
    expect(m.agentPid).toBe(runtime.agentPid);
    expect(m.controllerReachable).toBe(true);
    expect(m.controllerEndpoint).toBe(runtime.controllerEndpoint);
    expect(m.startedAt).toBe(runtime.entryStartedAt);
    expect(m.attachedClients).toBeDefined();
  });

  it('controller loss is handled honestly (no process kill): entry and session are preserved and marked unreachable, prompt reports offline, prune stays safe', async () => {
    const injured = await startRuntime('loss_runtime_1');
    started.push({ runtimePid: injured.runtimePid, agentPid: injured.agentPid });

    expect(isProcessAlive(injured.runtimePid)).toBe(true);
    const reachable = await waitFor(async () => {
      const res = await sendControllerRequest(injured.controllerEndpoint, {
        id: 'loss-pre',
        method: 'ping',
      });
      return res.type === 'success';
    }, 5000);
    expect(reachable).toBe(true);
    await expect(isEntryReachable(getDetachedEntry(injured.runtimeId)!)).resolves.toBe(true);

    // Simulate the reported state: the controller endpoint vanishes while the
    // runtime PID stays alive. There is no process-kill watchdog, so the
    // runtime must NOT be terminated, and neither the detached entry nor the
    // session record may be touched while the runtime wrapper PID is alive.
    await fs.promises.unlink(injured.controllerEndpoint);

    // No kill: the runtime PID must remain alive well past any watchdog window.
    await sleep(700);
    expect(isProcessAlive(injured.runtimePid)).toBe(true);

    // Truthful state: the entry is retained but provably controller-unreachable.
    const entry = getDetachedEntry(injured.runtimeId);
    expect(entry).toBeDefined();
    await expect(isEntryReachable(entry!)).resolves.toBe(false);

    // The session survives too (liveness is gated on the alive runtime PID),
    // so state is consistent rather than a live-looking entry with no session.
    const sessionStill = (loadSessions().detachpro || []).filter(
      (s) => s.sessionKey === 'loss_runtime_1'
    ).length;
    expect(sessionStill).toBe(1);

    // `airelay prompt` must not claim the session is usable when the
    // controller is gone — it reports controller offline, never a fake success
    // and never an inconsistent "Session not found".
    const errMsgs: string[] = [];
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation((...a: unknown[]) => errMsgs.push(a.join(' ')));
    const promptCode = await promptCommand('loss_runtime_1', 'ping-loss', { fastEnter: true });
    errSpy.mockRestore();
    expect(promptCode).toBe(1);
    expect(errMsgs.some((e) => e.includes('Controller offline'))).toBe(true);
    expect(errMsgs.some((e) => e.includes('✓'))).toBe(false);

    // Prune stays safe: PID alive + controller unreachable -> kept (PID-reuse
    // protection). Never deletes a live runtime, never kills anything.
    const removed = await pruneDetachedEntries();
    expect(removed).toBe(0);
    expect(getDetachedEntry(injured.runtimeId)).toBeDefined();
  });

  it('duplicate-key ambiguity resolves deterministically to the newest runtime', () => {
    const now = Date.now();
    addDetachedEntry({
      runtimeId: 'dup-old-1',
      sessionKey: 'dup_key',
      profile: 'detachpro',
      cwd: testEnv.testDir,
      runtimePid: process.ppid,
      agentPid: process.ppid,
      controllerEndpoint: path.join(testEnv.socketsDir, 'dup-old.sock'),
      startedAt: now - 5000,
      attachedClients: 0,
    });
    addDetachedEntry({
      runtimeId: 'dup-new-1',
      sessionKey: 'dup_key',
      profile: 'detachpro',
      cwd: testEnv.testDir,
      runtimePid: process.ppid,
      agentPid: process.ppid,
      controllerEndpoint: path.join(testEnv.socketsDir, 'dup-new.sock'),
      startedAt: now - 1000,
      attachedClients: 0,
    });

    const resolved = findDetachedBySessionKey('dup_key');
    expect(resolved?.runtimeId).toBe('dup-new-1');
  });

  it('airelay cleanup does not kill active detached runtimes (launcher already exited)', async () => {
    expect(isProcessAlive(runtime.runtimePid)).toBe(true);
    const orphaned = cleanupOrphanedPIDs();
    expect(orphaned).toBe(0);
    expect(isProcessAlive(runtime.runtimePid)).toBe(true);
    expect(getDetachedEntry(runtime.runtimeId)).toBeDefined();
  });

  it('ordinary start (no --detached) never creates a detached registry entry', async () => {
    await ensureBuilt();
    const before = listDetachedEntries().length;
    const exit = await runCommand('exitpro', [], { usePty: true });
    expect(exit).toBe(0);
    expect(listDetachedEntries().length).toBe(before);
  });
});

describe('start flag parsing and registry helpers', () => {
  it('parses plain start without detached flag', () => {
    const parsed = parseArgs(['node', 'airelay', 'start', 'detachpro', '--', '-a']);
    expect(parsed.flags.detached).toBeUndefined();
    expect(parsed.extraArgs).toEqual(['-a']);
    expect(parsed.profile).toBe('detachpro');
  });

  it('parses start --detached before the profile', () => {
    const parsed = parseArgs(['node', 'airelay', 'start', '--detached', 'detachpro', '--', '-a']);
    expect(parsed.flags.detached).toBe(true);
    expect(parsed.profile).toBe('detachpro');
    expect(parsed.extraArgs).toEqual(['-a']);
  });

  it('parses start profile --detached after the profile and still keeps harness args', () => {
    const parsed = parseArgs(['node', 'airelay', 'start', 'detachpro', '--detached', '-a']);
    expect(parsed.flags.detached).toBe(true);
    expect(parsed.extraArgs).toEqual(['-a']);
  });

  it('parses __detach-run internal command with --key', () => {
    const parsed = parseArgs([
      'node',
      'airelay',
      '__detach-run',
      'detachpro',
      '--key',
      'k1',
      '--',
      '-a',
    ]);
    expect(parsed.command).toBe('__detach-run');
    expect(parsed.flags.key).toBe('k1');
    expect(parsed.extraArgs).toEqual(['-a']);
  });
});
