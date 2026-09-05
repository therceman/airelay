import { runCommand } from './run';
import { loadConfig } from '../config/load';
import {
  findSessionByKey,
  getSessions,
  isControllerReachable,
  SessionEntry,
  pruneStaleSessions,
} from './sessions';
import { getLaunchHistory, LaunchHistoryEntry, markLaunchHistoryUsed } from './history';
import Enquirer from 'enquirer';
import path from 'path';
import { detectHarness } from '../utils/harness';
import { withAirelayPromptSymbols } from '../utils/enquirer';

/**
 * Shared helper to resume a session entry with prompt-capable launch.
 * Builds resumeArgs, warns about missing metadata, and calls runCommand with PTY.
 */
function isProcessAlive(pid?: number): boolean {
  if (pid === undefined) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findActiveSession(
  profile: string,
  profileSessionId: string
): Promise<SessionEntry | undefined> {
  const candidates = getSessions(profile).filter(
    (candidate) => candidate.profileSessionId === profileSessionId
  );

  for (const candidate of candidates) {
    if (isProcessAlive(candidate.pid)) {
      return candidate;
    }
    if (
      candidate.controllerEndpoint &&
      (await isControllerReachable(candidate.controllerEndpoint))
    ) {
      return candidate;
    }
  }

  return undefined;
}

function reportActiveSession(profileSessionId: string): void {
  console.error(
    'Failed to resume session in this terminal, because this session is active in another terminal window.'
  );
  console.error(`Session ID: ${profileSessionId}`);
  console.error('Use the existing terminal for this session, or choose "Start new session".');
}

async function rejectActiveSession(profile: string, profileSessionId: string): Promise<boolean> {
  if (!(await findActiveSession(profile, profileSessionId))) {
    return false;
  }

  reportActiveSession(profileSessionId);
  return true;
}

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

export function getSameHarnessProfiles(profile: string): string[] {
  const config = loadConfig();
  const selectedProfile = config.profiles[profile];
  if (!selectedProfile) {
    return [];
  }

  const harness = detectHarness(selectedProfile.executable);
  return Object.entries(config.profiles)
    .filter(
      ([name, candidate]) => name !== profile && detectHarness(candidate.executable) === harness
    )
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

async function chooseResumeProfile(profile: string): Promise<string> {
  const alternativeProfiles = getSameHarnessProfiles(profile);
  if (alternativeProfiles.length === 0) {
    return profile;
  }

  const actionResult = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'select',
      name: 'resumeAction',
      message: 'Select how to resume this session',
      choices: [
        { name: 'launch', message: 'Launch' },
        { name: 'switchProfile', message: 'Use another profile (same harness)' },
      ],
      initial: 0,
    })
  )) as { resumeAction: string };

  if (actionResult.resumeAction !== 'switchProfile') {
    return profile;
  }

  const profileResult = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'select',
      name: 'profile',
      message: 'Select another profile (same harness)',
      choices: alternativeProfiles.map((name) => ({ name, message: name })),
      initial: 0,
    })
  )) as { profile: string };

  if (!alternativeProfiles.includes(profileResult.profile)) {
    console.error('Error: Selected profile is not available for this session.');
    process.exit(1);
    return profile;
  }

  return profileResult.profile;
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

export function formatAge(timestamp: number, now = Date.now()): string {
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

function formatResumeChoiceName(
  profile: string,
  sessionKey: string | undefined,
  duplicateNumber: number
): string {
  const identity = sessionKey ? `${profile} (${sessionKey})` : `${profile} (unkeyed)`;
  return duplicateNumber > 1 ? `${identity} #${duplicateNumber}` : identity;
}

function getResumeChoiceNames(entries: LaunchHistoryEntry[]): string[] {
  const counts = new Map<string, number>();
  return entries.map((entry) => {
    const base = formatResumeChoiceName(entry.profile, entry.sessionKey, 1);
    const nextCount = (counts.get(base) || 0) + 1;
    counts.set(base, nextCount);
    return formatResumeChoiceName(entry.profile, entry.sessionKey, nextCount);
  });
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

export function getLatestResumableSession(
  targetCwd = process.cwd()
): LaunchHistoryEntry | undefined {
  return getFolderHistory(targetCwd)[0];
}

export function hasSwitchableLastSession(targetCwd = process.cwd()): boolean {
  const latestSession = getLatestResumableSession(targetCwd);
  return !!latestSession && getSameHarnessProfiles(latestSession.profile).length > 0;
}

function formatLastSessionSummary(entry: LaunchHistoryEntry): string {
  const sessionKey = entry.sessionKey ? `${entry.sessionKey} -- ` : '';
  return `${sessionKey}${getHarnessArgs(entry).join(' ')}`;
}

function markResumeHistoryUsed(entry: LaunchHistoryEntry, profile: string): void {
  if (profile === entry.profile) {
    markLaunchHistoryUsed(entry.id);
    return;
  }

  markLaunchHistoryUsed(entry.id, Date.now(), profile);
}

export interface ResumableProject {
  path: string;
  lastUsed: number;
}

export function getResumableProjects(): ResumableProject[] {
  const projects = new Map<string, ResumableProject>();

  for (const entry of getLaunchHistory()) {
    if (getResumeSessionId(getHarnessArgs(entry)) === undefined) {
      continue;
    }

    const projectPath = path.resolve(entry.invocationCwd);
    const lastUsed = getLastUsed(entry);
    const existing = projects.get(projectPath);
    if (!existing || lastUsed > existing.lastUsed) {
      projects.set(projectPath, { path: projectPath, lastUsed });
    }
  }

  return [...projects.values()].sort((a, b) => b.lastUsed - a.lastUsed);
}

export function getResumableProjectPaths(): string[] {
  return getResumableProjects().map((project) => project.path);
}

async function resumeFromFolder(targetCwd = process.cwd()): Promise<void> {
  const history = getFolderHistory(targetCwd);
  if (history.length === 0) {
    console.error(`No resumable sessions found in ${targetCwd}`);
    console.error('Run `airelay start <profile> -- resume <session-id>` first.');
    process.exit(1);
    return;
  }

  const choiceNames = getResumeChoiceNames(history);
  const choices = history.map((entry, index) => ({
    // Keep the prompt summary user-facing; history IDs remain internal.
    name: choiceNames[index],
    message: formatHistoryChoice(entry),
  }));
  const result = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'select',
      name: 'historyEntry',
      message: 'Select a session to resume',
      choices,
      initial: 0,
    })
  )) as { historyEntry: string };

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

  const launchProfile = await chooseResumeProfile(selected.profile);
  if (
    (await rejectActiveSession(selected.profile, profileSessionId)) ||
    (launchProfile !== selected.profile &&
      (await rejectActiveSession(launchProfile, profileSessionId)))
  ) {
    process.exit(1);
    return;
  }

  const exitCode = await resumeSession(launchProfile, {
    id: profileSessionId,
    profile: selected.profile,
    lastUsed: getLastUsed(selected),
    cwd: selected.invocationCwd,
    sessionKey: selected.sessionKey,
    profileSessionId,
    profileArgs,
  });
  markResumeHistoryUsed(selected, launchProfile);
  process.exit(exitCode);
}

export async function switchLastSessionProfile(targetCwd = process.cwd()): Promise<void> {
  const selected = getLatestResumableSession(targetCwd);
  if (!selected) {
    console.error(`No resumable sessions found in ${targetCwd}`);
    process.exit(1);
    return;
  }

  const profileArgs = getHarnessArgs(selected);
  const profileSessionId = getResumeSessionId(profileArgs);
  if (!profileSessionId) {
    console.error('Error: Last session does not contain a resumable session ID.');
    process.exit(1);
    return;
  }

  const alternativeProfiles = getSameHarnessProfiles(selected.profile);
  if (alternativeProfiles.length === 0) {
    console.error('No alternative profiles use the same harness as the last session.');
    process.exit(1);
    return;
  }

  console.log('');
  console.log('Last session:');
  console.log(`  ${formatLastSessionSummary(selected)}`);
  console.log('');

  const profileChoices = [
    ...alternativeProfiles.map((name) => ({ name, message: name })),
    { name: selected.profile, message: `${selected.profile} (current)` },
  ];
  const result = (await Enquirer.prompt(
    withAirelayPromptSymbols({
      type: 'select',
      name: 'profile',
      message: 'Select a profile',
      choices: profileChoices,
      initial: 0,
    })
  )) as { profile: string };

  const launchProfile = profileChoices.some((choice) => choice.name === result.profile)
    ? result.profile
    : undefined;
  if (!launchProfile) {
    console.error('Error: Selected profile is not available for this session.');
    process.exit(1);
    return;
  }

  if (
    (await rejectActiveSession(selected.profile, profileSessionId)) ||
    (launchProfile !== selected.profile &&
      (await rejectActiveSession(launchProfile, profileSessionId)))
  ) {
    process.exit(1);
    return;
  }

  const exitCode = await resumeSession(launchProfile, {
    id: profileSessionId,
    profile: selected.profile,
    lastUsed: getLastUsed(selected),
    cwd: selected.invocationCwd,
    sessionKey: selected.sessionKey,
    profileSessionId,
    profileArgs,
  });
  markResumeHistoryUsed(selected, launchProfile);
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
    if (
      found.session.profileSessionId &&
      (await rejectActiveSession(found.profile, found.session.profileSessionId))
    ) {
      process.exit(1);
      return;
    }

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

  const sessionCounts = new Map<string, number>();
  const sessionChoices = sessions.map((s) => {
    const cwdInfo = s.cwd ? ` ${s.cwd}` : '';
    const keyInfo = s.sessionKey ? ` [${s.sessionKey}]` : '';
    const pidInfo = s.profileSessionId ? ` (profile: ${s.profileSessionId})` : '';
    const baseName = formatResumeChoiceName(profileOrSessionKey, s.sessionKey, 1);
    const nextCount = (sessionCounts.get(baseName) || 0) + 1;
    sessionCounts.set(baseName, nextCount);
    return {
      name: formatResumeChoiceName(profileOrSessionKey, s.sessionKey, nextCount),
      message: `[${formatAge(s.lastUsed)}] ${s.id}${keyInfo}${cwdInfo}${pidInfo}`,
    };
  });

  const sessionPrompt = withAirelayPromptSymbols({
    type: 'select',
    name: 'session',
    message: 'Select a session to resume',
    choices: sessionChoices,
    initial: 0,
  });

  const sessionResult = (await Enquirer.prompt(sessionPrompt)) as { session: string };
  const selectedIndex = sessionChoices.findIndex((choice) => choice.name === sessionResult.session);
  const selectedSession = selectedIndex === -1 ? undefined : sessions[selectedIndex];

  if (!selectedSession) {
    console.error('Error: Selected session not found.');
    process.exit(1);
    return;
  }

  const launchProfile = await chooseResumeProfile(profileOrSessionKey);
  if (
    (selectedSession.profileSessionId &&
      (await rejectActiveSession(profileOrSessionKey, selectedSession.profileSessionId))) ||
    (launchProfile !== profileOrSessionKey &&
      selectedSession.profileSessionId &&
      (await rejectActiveSession(launchProfile, selectedSession.profileSessionId)))
  ) {
    process.exit(1);
    return;
  }

  const exitCode = await resumeSession(launchProfile, selectedSession);
  process.exit(exitCode);
}
