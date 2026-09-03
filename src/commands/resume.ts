import { runCommand } from './run';
import { loadConfig } from '../config/load';
import { findSessionByKey, getSessions, SessionEntry, pruneStaleSessions } from './sessions';
import { getLaunchHistory, LaunchHistoryEntry, markLaunchHistoryUsed } from './history';
import Enquirer from 'enquirer';
import path from 'path';

/**
 * Shared helper to resume a session entry with prompt-capable launch.
 * Builds resumeArgs, warns about missing metadata, and calls runCommand with PTY.
 */
async function resumeSession(profile: string, session: SessionEntry): Promise<number> {
  const resumeArgs =
    session.profileArgs && session.profileArgs.length > 0
      ? session.profileArgs
      : ['-s', session.id];

  if (!session.profileSessionId) {
    console.warn(
      'Warning: This session has no profile session metadata. Restoring with internal id.'
    );
    console.warn('Restart the session and save again for better restore support.');
  }

  return runCommand(profile, resumeArgs, {
    cwd: session.cwd,
    sessionKey: session.sessionKey,
    profileSessionId: session.profileSessionId,
    profileArgs: session.profileArgs,
    usePty: true,
  });
}

function getHarnessArgs(entry: LaunchHistoryEntry): string[] {
  const separatorIndex = entry.argv.indexOf('--');
  if (separatorIndex !== -1) {
    return entry.argv.slice(separatorIndex + 1);
  }

  // `--` is optional after the profile name. Strip airelay-owned start flags
  // so old and hand-written history rows can still be resumed.
  let index = 2; // `start <profile>`
  while (index < entry.argv.length) {
    if (entry.argv[index] === '--key') {
      index += 2;
      continue;
    }
    if (entry.argv[index] === '--detached') {
      index += 1;
      continue;
    }
    return entry.argv.slice(index);
  }

  return [];
}

function getResumeSessionId(args: string[]): string | undefined {
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === 'resume' || args[index] === '-s') {
      return args[index + 1];
    }
  }
  return undefined;
}

function formatAge(timestamp: number, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return '<1m ago';
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${String(Math.floor(hours / 24)).padStart(2, '0')}d ago`;
}

function getLastUsed(entry: LaunchHistoryEntry): number {
  return entry.lastUsed ?? entry.startedAt;
}

function formatHistoryChoice(entry: LaunchHistoryEntry, now = Date.now()): string {
  const folder = path.basename(path.resolve(entry.invocationCwd)) || entry.invocationCwd;
  const context = entry.sessionKey || folder;
  const harnessArgs = getHarnessArgs(entry);
  const args = harnessArgs.length > 0 ? ` -- ${harnessArgs.join(' ')}` : '';
  return `[${formatAge(getLastUsed(entry), now)}] ${entry.profile} (${context})${args}`;
}

function getFolderHistory(targetCwd = process.cwd()): LaunchHistoryEntry[] {
  const currentCwd = path.resolve(targetCwd);
  return getLaunchHistory()
    .filter(
      (entry) =>
        path.resolve(entry.invocationCwd) === currentCwd &&
        getResumeSessionId(getHarnessArgs(entry)) !== undefined
    )
    .sort((a, b) => getLastUsed(b) - getLastUsed(a));
}

export function getResumableProjectPaths(): string[] {
  const projects: string[] = [];
  const seen = new Set<string>();

  for (const entry of getLaunchHistory()) {
    if (getResumeSessionId(getHarnessArgs(entry)) === undefined) {
      continue;
    }

    const projectPath = path.resolve(entry.invocationCwd);
    if (!seen.has(projectPath)) {
      seen.add(projectPath);
      projects.push(projectPath);
    }
  }

  return projects;
}

async function resumeFromFolder(targetCwd = process.cwd()): Promise<void> {
  const history = getFolderHistory(targetCwd);
  if (history.length === 0) {
    console.error(`No resumable sessions found in ${targetCwd}`);
    console.error('Run `airelay start <profile> -- resume <session-id>` first.');
    process.exit(1);
    return;
  }

  const choices = history.map((entry, index) => ({
    // A history row, rather than a session key/id, is the choice identity.
    name: entry.id || `history-${index}`,
    message: formatHistoryChoice(entry),
  }));
  const result = (await Enquirer.prompt({
    type: 'select',
    name: 'historyEntry',
    message: 'Select a session to resume',
    choices,
    initial: 0,
  })) as { historyEntry: string };

  const selectedIndex = choices.findIndex((choice) => choice.name === result.historyEntry);
  const selected = selectedIndex === -1 ? undefined : history[selectedIndex];
  if (!selected) {
    console.error('Error: Selected history entry not found.');
    process.exit(1);
    return;
  }

  const profileArgs = getHarnessArgs(selected);
  const profileSessionId = getResumeSessionId(profileArgs);
  if (!profileSessionId) {
    console.error('Error: Selected history entry does not contain a resumable session ID.');
    process.exit(1);
    return;
  }

  markLaunchHistoryUsed(selected.id);

  const exitCode = await resumeSession(selected.profile, {
    id: profileSessionId,
    profile: selected.profile,
    lastUsed: getLastUsed(selected),
    cwd: selected.invocationCwd,
    sessionKey: selected.sessionKey,
    profileSessionId,
    profileArgs,
  });
  process.exit(exitCode);
}

export async function resumeCommand(
  profileOrSessionKey?: string,
  targetCwd = process.cwd()
): Promise<void> {
  await pruneStaleSessions();

  if (!profileOrSessionKey) {
    await resumeFromFolder(targetCwd);
    return;
  }

  const found = findSessionByKey(profileOrSessionKey);

  if (found) {
    const exitCode = await resumeSession(found.profile, found.session);
    process.exit(exitCode);
    return;
  }

  // Not found as session key/ID, check if it's a profile name
  const config = loadConfig();
  if (!config.profiles[profileOrSessionKey]) {
    console.error(`Error: Profile or session not found: ${profileOrSessionKey}`);
    console.error('Usage: airelay resume [profile|session-key]');
    process.exit(1);
  }

  // It's a profile name - show session selector
  const sessions = [...getSessions(profileOrSessionKey)].sort((a, b) => b.lastUsed - a.lastUsed);
  if (sessions.length === 0) {
    console.error(`No existing sessions for profile: ${profileOrSessionKey}`);
    process.exit(1);
  }

  const sessionChoices = sessions.map((s) => {
    const cwdInfo = s.cwd ? ` ${s.cwd}` : '';
    const keyInfo = s.sessionKey ? ` [${s.sessionKey}]` : '';
    const pidInfo = s.profileSessionId ? ` (profile: ${s.profileSessionId})` : '';
    return {
      name: s.id,
      message: `[${formatAge(s.lastUsed)}] ${s.id}${keyInfo}${cwdInfo}${pidInfo}`,
    };
  });

  const sessionPrompt = {
    type: 'select',
    name: 'session',
    message: 'Select a session to resume',
    choices: sessionChoices,
    initial: 0,
  };

  const sessionResult = (await Enquirer.prompt(sessionPrompt)) as { session: string };
  const selectedSession = sessions.find((s) => s.id === sessionResult.session);

  if (!selectedSession) {
    console.error('Error: Selected session not found.');
    process.exit(1);
  }

  const exitCode = await resumeSession(profileOrSessionKey, selectedSession);
  process.exit(exitCode);
}
