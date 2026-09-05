import os from 'os';
import path from 'path';
import { createJsonStore } from '../utils/json-store';

export interface LaunchHistoryEntry {
  id: string;
  profile: string;
  sessionKey: string;
  invocationCwd: string;
  startedAt: number;
  lastUsed?: number;
  argv: string[];
  command: string;
}

const store = createJsonStore<LaunchHistoryEntry[]>({
  envVar: 'AIRELAY_HISTORY',
  defaultPath: path.join(os.homedir(), '.airelay', 'launch-history.json'),
});

function getHistoryEntryTime(entry: LaunchHistoryEntry): number {
  return entry.lastUsed ?? entry.startedAt;
}

function getHistoryEntryIdentity(entry: LaunchHistoryEntry): string {
  return JSON.stringify([
    entry.profile,
    entry.sessionKey,
    path.resolve(entry.invocationCwd),
    entry.argv,
  ]);
}

function deduplicateHistory(entries: LaunchHistoryEntry[]): LaunchHistoryEntry[] {
  const unique = new Map<string, LaunchHistoryEntry>();
  for (const entry of entries) {
    const identity = getHistoryEntryIdentity(entry);
    const existing = unique.get(identity);
    if (!existing || getHistoryEntryTime(entry) > getHistoryEntryTime(existing)) {
      unique.set(identity, entry);
    }
  }
  return [...unique.values()];
}

function loadHistory(): LaunchHistoryEntry[] {
  const loaded = store.load();
  if (!Array.isArray(loaded)) {
    return [];
  }

  const deduplicated = deduplicateHistory(loaded);
  if (deduplicated.length !== loaded.length) {
    store.save(deduplicated);
  }
  return deduplicated;
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

  const history = [entry, ...loadHistory()];
  store.save(deduplicateHistory(history).slice(0, 1000));
  return entry;
}

/** Replace a provisional TUI launch row once the harness native session is known. */
export function finalizeLaunchHistoryEntry(input: {
  profile: string;
  provisionalSessionKey: string;
  sessionKey: string;
  invocationCwd: string;
  profileArgs: string[];
  finishedAt?: number;
}): boolean {
  const currentCwd = path.resolve(input.invocationCwd);
  const history = loadHistory();
  const index = history.findIndex(
    (entry) =>
      entry.profile === input.profile &&
      entry.sessionKey === input.provisionalSessionKey &&
      path.resolve(entry.invocationCwd) === currentCwd
  );
  if (index === -1) {
    return false;
  }

  const previous = history[index];
  const argv = ['start', input.profile, '--key', input.sessionKey, '--', ...input.profileArgs];
  const finalized: LaunchHistoryEntry = {
    ...previous,
    sessionKey: input.sessionKey,
    argv,
    command: renderLaunchCommand(argv),
    lastUsed: input.finishedAt ?? Date.now(),
  };
  const remaining = history.filter(
    (entry, entryIndex) =>
      entryIndex !== index &&
      (entry.profile !== input.profile ||
        entry.sessionKey !== input.sessionKey ||
        path.resolve(entry.invocationCwd) !== currentCwd)
  );
  store.save(deduplicateHistory([finalized, ...remaining]).slice(0, 1000));
  return true;
}

export function getLaunchHistory(): LaunchHistoryEntry[] {
  return loadHistory().sort((a, b) => (b.lastUsed ?? b.startedAt) - (a.lastUsed ?? a.startedAt));
}

/** Mark a launch as used and optionally record the profile selected for its next resume. */
export function markLaunchHistoryUsed(
  id: string,
  lastUsed = Date.now(),
  profile?: string
): boolean {
  const history = loadHistory();
  const entry = history.find((candidate) => candidate.id === id);
  if (!entry) {
    return false;
  }

  if (profile !== undefined) {
    entry.profile = profile;
    if (entry.argv[0] === 'start' && entry.argv.length > 1) {
      entry.argv[1] = profile;
      entry.command = renderLaunchCommand(entry.argv);
    }
  }
  entry.lastUsed = lastUsed;
  store.save(history);
  return true;
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

History entries are kept as separate launch rows, even when they use the same
session key. Exact duplicate launches are collapsed, keeping the most recently
used row. The remove command affects matching entries for the current directory.
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
