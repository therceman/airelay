import os from 'os';
import path from 'path';
import { createJsonStore } from '../utils/json-store';

export interface LaunchHistoryEntry {
  id: string;
  profile: string;
  sessionKey: string;
  invocationCwd: string;
  startedAt: number;
  argv: string[];
  command: string;
}

const store = createJsonStore<LaunchHistoryEntry[]>({
  envVar: 'AIRELAY_HISTORY',
  defaultPath: path.join(os.homedir(), '.airelay', 'launch-history.json'),
});

function loadHistory(): LaunchHistoryEntry[] {
  const history = store.load();
  return Array.isArray(history) ? history : [];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

export function renderLaunchCommand(argv: string[]): string {
  return ['airelay', ...argv].map(shellQuote).join(' ');
}

function createHistoryId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordLaunchHistory(input: {
  profile: string;
  sessionKey: string;
  invocationCwd: string;
  argv: string[];
  startedAt?: number;
}): LaunchHistoryEntry {
  const entry: LaunchHistoryEntry = {
    id: createHistoryId(),
    profile: input.profile,
    sessionKey: input.sessionKey,
    invocationCwd: path.resolve(input.invocationCwd),
    startedAt: input.startedAt ?? Date.now(),
    argv: [...input.argv],
    command: renderLaunchCommand(input.argv),
  };

  const history = loadHistory();
  history.unshift(entry);
  store.save(history.slice(0, 1000));
  return entry;
}

export function getLaunchHistory(): LaunchHistoryEntry[] {
  return loadHistory().sort((a, b) => b.startedAt - a.startedAt);
}

export interface HistoryCommandOptions {
  cwd?: boolean;
  json?: boolean;
}

function normalizeCwd(cwd: string): string {
  const home = os.homedir();
  return cwd === home
    ? '~'
    : cwd.startsWith(`${home}${path.sep}`)
      ? `~${cwd.slice(home.length)}`
      : cwd;
}

export function historyCommand(options?: HistoryCommandOptions): void {
  let history = getLaunchHistory();
  if (options?.cwd) {
    const currentCwd = path.resolve(process.cwd());
    history = history.filter((entry) => path.resolve(entry.invocationCwd) === currentCwd);
  }

  if (options?.json) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  if (history.length === 0) {
    console.log('No launch history found.');
    return;
  }

  for (const entry of history) {
    console.log(
      `${entry.profile} (key: ${entry.sessionKey}) @ ${normalizeCwd(entry.invocationCwd)}`
    );
    console.log(`  started: ${new Date(entry.startedAt).toISOString()}`);
    console.log(`  command: ${entry.command}`);
  }
}
