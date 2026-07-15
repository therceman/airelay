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
  const loaded = store.load();
  if (!Array.isArray(loaded)) {
    return [];
  }

  const sorted = [...loaded].sort((a, b) => b.startedAt - a.startedAt);
  const seenKeys = new Set<string>();
  const unique = sorted.filter((entry) => {
    if (seenKeys.has(entry.sessionKey)) {
      return false;
    }
    seenKeys.add(entry.sessionKey);
    return true;
  });

  if (unique.length !== loaded.length) {
    store.save(unique);
  }
  return unique;
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
  const withoutKey = history.filter((existing) => existing.sessionKey !== entry.sessionKey);
  withoutKey.unshift(entry);
  store.save(withoutKey.slice(0, 1000));
  return entry;
}

export function getLaunchHistory(): LaunchHistoryEntry[] {
  return loadHistory().sort((a, b) => b.startedAt - a.startedAt);
}

export function removeLaunchHistory(sessionKey: string, invocationCwd = process.cwd()): number {
  const currentCwd = path.resolve(invocationCwd);
  const history = loadHistory();
  const remaining = history.filter(
    (entry) => entry.sessionKey !== sessionKey || path.resolve(entry.invocationCwd) !== currentCwd
  );
  const removed = history.length - remaining.length;
  if (removed > 0) {
    store.save(remaining);
  }
  return removed;
}

export function removeHistoryCommand(sessionKey: string): void {
  const removed = removeLaunchHistory(sessionKey);
  if (removed > 0) {
    console.log(
      `Removed ${removed} history entr${removed === 1 ? 'y' : 'ies'} for key "${sessionKey}".`
    );
    return;
  }
  console.log(`No history entry found for key "${sessionKey}" in the current directory.`);
}

export interface HistoryCommandOptions {
  all?: boolean;
  json?: boolean;
}

export function historyHelpCommand(): void {
  console.log(`
airelay history - list executed airelay launch commands

Usage:
  airelay history                  List launches from the current directory
  airelay history --all            List launches from all directories
  airelay history --json           Output current-directory history as JSON
  airelay history --all --json     Output all history as JSON
  airelay history remove <key>     Remove the current-directory entry by key
  airelay history help             Show this help

History entries are unique by session key. Running a new start with an existing
key replaces its previous history entry. The remove command only affects the
entry for the current directory.
`);
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
  if (!options?.all) {
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
    console.log(`> ${entry.command}`);
  }
}
