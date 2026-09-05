import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'cross-spawn';
import { runCommand, DetachedReadyInfo } from './run';
import {
  listDetachedEntries,
  isEntryReachable,
  pruneDetachedEntries,
} from '../runtime/detached-registry';

/** Start receipt written by the supervised runtime and read by the launcher. */
type DetachedReceipt = (DetachedReadyInfo & { ok: true }) | { ok: false; error: string };

const RECEIPT_TIMEOUT_MS = 30000;

/**
 * Resolve the CLI entry used to launch the detached runtime child. The child
 * process is the same airelay CLI invoked with the hidden `__detach-run`
 * command, so it shares the canonical controller/session/runtime code.
 */
function getDetachedCliEntry(): { cmd: string; prefix: string[] } {
  const root = path.join(__dirname, '..', '..');
  return {
    cmd: process.execPath,
    prefix: [path.join(root, 'dist', 'airelay.cjs')],
  };
}

function writeDetachedReceipt(receiptPath: string, receipt: DetachedReceipt): void {
  try {
    const dir = path.dirname(receiptPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf-8');
  } catch {
    // Best-effort transport; failure to write only delays the launcher's timeout.
  }
}

function readLaunchArgv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
      return value as string[];
    }
  } catch {
    // Ignore malformed launch argv
  }
  return undefined;
}

interface ReceiptResult {
  ok: boolean;
  data?: DetachedReceipt;
  error?: string;
}

function waitForReceipt(
  receiptPath: string,
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<ReceiptResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (result: ReceiptResult): void => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      resolve(result);
    };

    const onExit = (code: number | null): void => {
      if (!fs.existsSync(receiptPath)) {
        finish({
          ok: false,
          error: `Detached runtime exited early (code ${code ?? 'unknown'}) before writing its startup receipt.`,
        });
      }
    };

    const onError = (err: Error): void => {
      finish({ ok: false, error: `Failed to launch detached runtime: ${err.message}` });
    };

    child.on('exit', onExit);
    child.on('error', onError);

    const pollTimer = setInterval(() => {
      if (fs.existsSync(receiptPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as DetachedReceipt;
          finish({ ok: content.ok === true, data: content });
        } catch {
          // Partial write; keep polling.
        }
      } else if (Date.now() - startedAt > timeoutMs) {
        finish({
          ok: false,
          error: `Timed out after ${timeoutMs}ms waiting for the detached runtime to start.`,
        });
      }
    }, 50);
  });
}

function printReceipt(info: DetachedReadyInfo): void {
  console.log('Detached session started:');
  console.log(`  session key:  ${info.sessionKey}`);
  console.log(`  runtime id:   ${info.runtimeId}`);
  console.log(`  runtime PID:  ${info.runtimePid}`);
  console.log(`  agent PID:    ${info.agentPid}`);
  console.log(`  controller:   ${info.controllerEndpoint}`);
  console.log(`  profile:      ${info.profile}`);
  console.log(`  cwd:          ${info.cwd}`);
  console.log(`  started:      ${new Date(info.startedAt).toISOString()}`);
  console.log(`Attach later with: airelay attach ${info.sessionKey}`);
}

/**
 * Launcher path for `airelay start --detached <profile>`.
 * Spawns a separate supervised runtime process that owns the PTY and agent,
 * returns a structured startup receipt, and never inherits this launcher's
 * stdin/stdout. The runtime continues after the launcher exits.
 */
export async function startDetachedCommand(
  profile: string,
  extraArgs: string[],
  options?: { key?: string; harnessSelfUpdate?: boolean; invocationCwd?: string }
): Promise<number> {
  const key = options?.key;
  const launchArgv = [
    'start',
    '--detached',
    profile,
    ...(key ? ['--key', key] : []),
    ...(extraArgs.length > 0 ? ['--', ...extraArgs] : []),
  ];

  const receiptDir =
    process.env.AIRELAY_DETACHED_RECEIPTS_DIR || path.join(os.homedir(), '.airelay', 'receipts');
  if (!fs.existsSync(receiptDir)) {
    fs.mkdirSync(receiptDir, { recursive: true });
  }
  const receiptPath = path.join(
    receiptDir,
    `detach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );

  const { cmd, prefix } = getDetachedCliEntry();
  const child = spawn(
    cmd,
    [
      ...prefix,
      '__detach-run',
      profile,
      ...(options?.harnessSelfUpdate !== undefined
        ? ['--harness-self-update', String(options.harnessSelfUpdate)]
        : []),
      ...(key ? ['--key', key] : []),
      ...(extraArgs.length > 0 ? ['--', ...extraArgs] : []),
    ],
    {
      cwd: options?.invocationCwd || process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        AIRELAY_DETACHED_RECEIPT: receiptPath,
        AIRELAY_DETACHED_LAUNCH_ARGV: JSON.stringify(launchArgv),
      } as Record<string, string> & NodeJS.ProcessEnv,
    }
  );
  child.unref();

  const result = await waitForReceipt(receiptPath, child, RECEIPT_TIMEOUT_MS);

  try {
    if (fs.existsSync(receiptPath)) {
      fs.unlinkSync(receiptPath);
    }
  } catch {
    // Best-effort receipt cleanup.
  }

  if (!result.ok || !result.data || result.data.ok !== true) {
    const message = result.data && 'error' in result.data ? result.data.error : result.error;
    console.error(`Error: ${message || 'Detached runtime failed to start.'}`);
    console.error('Check the profile executable and configuration, then retry.');
    return 1;
  }

  printReceipt(result.data);
  return 0;
}

/**
 * Hidden runtime entrypoint (`airelay __detach-run <profile> ...`) invoked by
 * the supervised detached runtime process. Runs the canonical PTY start path
 * with the detached flag and writes the startup receipt for the launcher.
 */
export async function detachedRuntimeMain(
  profile: string,
  extraArgs: string[],
  options?: { key?: string; harnessSelfUpdate?: boolean }
): Promise<number> {
  const receiptPath = process.env.AIRELAY_DETACHED_RECEIPT;
  const launchArgv = readLaunchArgv(process.env.AIRELAY_DETACHED_LAUNCH_ARGV);

  try {
    const code = await runCommand(profile, extraArgs, {
      usePty: true,
      sessionKey: options?.key,
      harnessSelfUpdate: options?.harnessSelfUpdate,
      detached: true,
      recordLaunch: launchArgv !== undefined,
      launchArgv,
      onDetachedReady: (info) => {
        if (receiptPath) {
          writeDetachedReceipt(receiptPath, { ok: true, ...info });
        }
      },
    });
    return code;
  } catch (e) {
    if (receiptPath) {
      writeDetachedReceipt(receiptPath, { ok: false, error: (e as Error).message });
    }
    return 1;
  }
}

interface DetachedListEntry {
  sessionKey: string;
  runtimeId: string;
  profile: string;
  cwd: string;
  runtimePid: number;
  agentPid: number;
  controllerReachable: boolean;
  controllerEndpoint: string;
  startedAt: number;
  attachedClients: number;
}

/** `airelay detached [--json]` — list active detached runtimes. */
export async function detachedListCommand(options?: { json?: boolean }): Promise<number> {
  const entries = listDetachedEntries();
  const probed = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      reachable: await isEntryReachable(entry),
    }))
  );

  const rows: DetachedListEntry[] = probed.map(({ entry, reachable }) => ({
    sessionKey: entry.sessionKey,
    runtimeId: entry.runtimeId,
    profile: entry.profile,
    cwd: entry.cwd,
    runtimePid: entry.runtimePid,
    agentPid: entry.agentPid,
    controllerReachable: reachable,
    controllerEndpoint: entry.controllerEndpoint,
    startedAt: entry.startedAt,
    attachedClients: entry.attachedClients,
  }));

  if (options?.json === true) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    console.log('No detached runtimes found.');
    return 0;
  }

  console.log('Detached runtimes:');
  console.log('KEY\tPROFILE\tRUNTIME PID\tAGENT PID\tCONTROLLER\tATTACHED\tSTARTED');
  for (const row of rows) {
    console.log(
      [
        row.sessionKey,
        row.profile,
        String(row.runtimePid),
        String(row.agentPid),
        row.controllerReachable ? 'reachable' : 'unreachable',
        String(row.attachedClients),
        new Date(row.startedAt).toISOString(),
      ].join('\t')
    );
  }
  return 0;
}

/** `airelay detached --prune` — remove only confirmed stale entries. */
export async function detachedPruneCommand(): Promise<number> {
  const removed = await pruneDetachedEntries();
  if (removed === 0) {
    console.log('No stale detached runtimes to prune.');
  } else {
    console.log(`Pruned ${removed} stale detached runtime${removed === 1 ? '' : 's'}.`);
  }
  return 0;
}
