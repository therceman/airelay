import fs from 'fs';
import path from 'path';
import { getConfigDir } from '../config/load';

export const MAX_RUNTIME_DIAGNOSTIC_EVENTS = 256;
export const MAX_RUNTIME_DIAGNOSTIC_FILES = 5;

export type StartupReleaseReason = 'quiet_period' | 'absolute_max';
export type RuntimeStopReason = 'exited' | 'hibernated' | 'failed';

export type RuntimeDiagnosticEvent =
  | { ts: number; event: 'runtime_start' }
  | { ts: number; event: 'resume_start'; resumable: true }
  | { ts: number; event: 'pty_spawn'; cols: number; rows: number }
  | { ts: number; event: 'pty_output'; bytes: number }
  | { ts: number; event: 'resize_requested'; cols: number; rows: number }
  | {
      ts: number;
      event: 'resize_held';
      cols: number;
      rows: number;
      reason: 'startup';
    }
  | { ts: number; event: 'resize_forwarded'; cols: number; rows: number }
  | {
      ts: number;
      event: 'startup_stabilized';
      reason: StartupReleaseReason;
    }
  | { ts: number; event: 'startup_max_reached' }
  | { ts: number; event: 'pty_exit'; code: number }
  | { ts: number; event: 'runtime_stop'; reason: RuntimeStopReason };

/** Narrow instrumentation boundary used by the authoritative PTY coordinator. */
export interface PtyDiagnostics {
  recordPtySpawn(cols: number, rows: number): void;
  recordPtyOutput(bytes: number): void;
  recordResizeRequested(cols: number, rows: number): void;
  recordResizeHeld(cols: number, rows: number): void;
  recordResizeForwarded(cols: number, rows: number): void;
  recordStartupStabilized(reason: StartupReleaseReason): void;
  recordStartupMaxReached(): void;
  recordPtyExit(code: number): void;
}

function sanitizeSessionKey(sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || 'unknown-session';
}

export function getRuntimeDiagnosticsDir(sessionKey: string): string {
  return path.join(getConfigDir(), 'debug', sanitizeSessionKey(sessionKey));
}

function traceSortValue(filePath: string): { mtimeMs: number; name: string } {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, name: path.basename(filePath) };
  } catch {
    return { mtimeMs: 0, name: path.basename(filePath) };
  }
}

function listTraceFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /^resume-[0-9]+(?:-[0-9]+)?\.jsonl$/.test(name))
      .map((name) => path.join(dir, name))
      .sort((a, b) => {
        const left = traceSortValue(a);
        const right = traceSortValue(b);
        return left.mtimeMs - right.mtimeMs || (left.name < right.name ? -1 : 1);
      });
  } catch {
    return [];
  }
}

function pruneTraceFiles(dir: string, currentFile: string): void {
  const files = listTraceFiles(dir);
  const removable = files.slice(0, Math.max(0, files.length - MAX_RUNTIME_DIAGNOSTIC_FILES));
  for (const filePath of removable) {
    if (filePath === currentFile) continue;
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Diagnostics are best-effort and never affect runtime execution.
    }
  }
}

function nextTracePath(dir: string): string {
  const timestamp = Date.now();
  for (let suffix = 0; suffix < 10000; suffix += 1) {
    const suffixPart = suffix === 0 ? '' : `-${suffix}`;
    const filePath = path.join(dir, `resume-${timestamp}${suffixPart}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return filePath;
    } catch {
      return filePath;
    }
  }
  return path.join(dir, `resume-${timestamp}-${process.pid}-${Math.random()}.jsonl`);
}

export class RuntimeDiagnostics implements PtyDiagnostics {
  private fd: number | null = null;
  private eventCount = 0;
  private closed = false;

  private constructor(
    public readonly sessionKey: string,
    public readonly traceFile?: string
  ) {}

  static start(sessionKey: string): RuntimeDiagnostics {
    const dir = getRuntimeDiagnosticsDir(sessionKey);
    const filePath = nextTracePath(dir);
    const diagnostics = new RuntimeDiagnostics(sessionKey, filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      diagnostics.fd = fs.openSync(filePath, 'a');
      pruneTraceFiles(dir, filePath);
    } catch {
      diagnostics.fd = null;
    }
    diagnostics.record({ ts: Date.now(), event: 'runtime_start' });
    diagnostics.record({ ts: Date.now(), event: 'resume_start', resumable: true });
    return diagnostics;
  }

  record(event: RuntimeDiagnosticEvent): void {
    if (this.closed || this.fd === null || this.eventCount >= MAX_RUNTIME_DIAGNOSTIC_EVENTS) {
      return;
    }
    try {
      fs.writeSync(this.fd, `${JSON.stringify(event)}\n`);
      this.eventCount += 1;
    } catch {
      // A diagnostic failure must never affect PTY or session control.
      try {
        fs.closeSync(this.fd);
      } catch {
        // Ignore cleanup failure for a broken diagnostic sink.
      }
      this.fd = null;
    }
  }

  recordPtySpawn(cols: number, rows: number): void {
    this.record({ ts: Date.now(), event: 'pty_spawn', cols, rows });
  }

  recordPtyOutput(bytes: number): void {
    this.record({ ts: Date.now(), event: 'pty_output', bytes });
  }

  recordResizeRequested(cols: number, rows: number): void {
    this.record({ ts: Date.now(), event: 'resize_requested', cols, rows });
  }

  recordResizeHeld(cols: number, rows: number): void {
    this.record({ ts: Date.now(), event: 'resize_held', cols, rows, reason: 'startup' });
  }

  recordResizeForwarded(cols: number, rows: number): void {
    this.record({ ts: Date.now(), event: 'resize_forwarded', cols, rows });
  }

  recordStartupStabilized(reason: StartupReleaseReason): void {
    this.record({ ts: Date.now(), event: 'startup_stabilized', reason });
  }

  recordStartupMaxReached(): void {
    this.record({ ts: Date.now(), event: 'startup_max_reached' });
  }

  recordPtyExit(code: number): void {
    this.record({ ts: Date.now(), event: 'pty_exit', code });
  }

  recordRuntimeStop(reason: RuntimeStopReason): void {
    this.record({ ts: Date.now(), event: 'runtime_stop', reason });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // Diagnostics are best-effort.
    }
    this.fd = null;
  }
}

export interface RuntimeDiagnosticTrace {
  traceFile: string;
  events: RuntimeDiagnosticEvent[];
}

export function readLatestRuntimeDiagnostic(sessionKey: string): RuntimeDiagnosticTrace | null {
  const files = listTraceFiles(getRuntimeDiagnosticsDir(sessionKey));
  const traceFile = files.at(-1);
  if (!traceFile) return null;

  try {
    const events: RuntimeDiagnosticEvent[] = [];
    for (const line of fs.readFileSync(traceFile, 'utf8').split('\n')) {
      if (!line || events.length >= MAX_RUNTIME_DIAGNOSTIC_EVENTS) continue;
      try {
        const event = JSON.parse(line) as RuntimeDiagnosticEvent;
        if (typeof event.ts === 'number' && typeof event.event === 'string') {
          events.push(event);
        }
      } catch {
        // Ignore a partial/corrupt diagnostic line and keep retrieval bounded.
      }
    }
    return { traceFile, events };
  } catch {
    return null;
  }
}
