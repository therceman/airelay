import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Enquirer from 'enquirer';
import { loadConfig } from '../config/load';
import { migrateLegacyHomeDirIfNeeded } from '../config/migrate';
import { runCommand } from './run';
import { addSession } from './sessions';
import {
  formatAge,
  getResumableProjects,
  hasSwitchableLastSession,
  resumeCommand,
  switchLastSessionProfile,
} from './resume';

function getLastUsedDirPath(): string {
  if (!process.env.AIRELAY_LAST_USED) {
    migrateLegacyHomeDirIfNeeded();
  }
  return process.env.AIRELAY_LAST_USED || path.join(os.homedir(), '.airelay', 'last-used');
}

function getCwdHash(): string {
  const cwd = process.cwd();
  return crypto.createHash('sha256').update(cwd).digest('hex').substring(0, 16);
}

function getLastUsedFilePath(): string {
  const lastUsedDir = getLastUsedDirPath();
  const cwdHash = getCwdHash();
  return path.join(lastUsedDir, `${cwdHash}.json`);
}

interface LastUsedData {
  profile: string;
  cwd: string;
  timestamp: number;
}

export function getLastUsedProfile(): string | null {
  try {
    const lastUsedFile = getLastUsedFilePath();
    if (!fs.existsSync(lastUsedFile)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(lastUsedFile, 'utf-8')) as LastUsedData;
    return data.profile || null;
  } catch {
    return null;
  }
}

export function setLastUsedProfile(profileName: string): void {
  try {
    const lastUsedFile = getLastUsedFilePath();
    const dir = path.dirname(lastUsedFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: LastUsedData = {
      profile: profileName,
      cwd: process.cwd(),
      timestamp: Date.now(),
    };
    fs.writeFileSync(lastUsedFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Ignore errors when saving last-used
  }
}

export function buildMainChoices(
  hasAnyResumableProjects: boolean,
  hasCurrentProjectSession = hasAnyResumableProjects,
  hasSwitchableSession = false
): Array<{ name: string; message: string }> {
  return [
    ...(hasAnyResumableProjects ? [{ name: 'Resume', message: 'Resume session' }] : []),
    ...(hasCurrentProjectSession
      ? [{ name: 'ResumeCurrent', message: 'Resume current project session' }]
      : []),
    ...(hasSwitchableSession
      ? [{ name: 'SwitchLast', message: 'Switch last session profile (same harness)' }]
      : []),
    { name: 'Start', message: 'Start new session' },
  ];
}

export async function selectCommand(): Promise<void> {
  const config = loadConfig();
  const profiles = Object.keys(config.profiles).sort();

  const DEFAULT_PROFILES = ['opencode', 'codex'];
  const customProfiles = profiles.filter((p) => !DEFAULT_PROFILES.includes(p));
  const defaultProfiles = profiles.filter((p) => DEFAULT_PROFILES.includes(p));
  const sortedProfiles = [...customProfiles, ...defaultProfiles];

  const resumableProjects = getResumableProjects();
  const hasCurrentProjectSession = resumableProjects.some(
    (project) => project.path === path.resolve(process.cwd())
  );
  const hasSwitchableSession = hasSwitchableLastSession(process.cwd());

  const mainChoices = buildMainChoices(
    resumableProjects.length > 0,
    hasCurrentProjectSession,
    hasSwitchableSession
  );

  const mainPrompt = {
    type: 'select',
    name: 'action',
    message: 'Select an option',
    choices: mainChoices,
    initial: 0,
  };

  const mainResult = (await Enquirer.prompt(mainPrompt)) as { action: string };
  const action = mainResult.action;

  if (action === 'Resume') {
    const projectResult = (await Enquirer.prompt({
      type: 'select',
      name: 'project',
      message: 'Select a project to resume',
      choices: resumableProjects.map((project) => ({
        name: project.path,
        message: `[${formatAge(project.lastUsed)}] ${formatProjectPath(project.path)}`,
      })),
      initial: 0,
    })) as { project: string };

    await resumeCommand(undefined, projectResult.project);
    return;
  }

  if (action === 'ResumeCurrent') {
    await resumeCommand(undefined, process.cwd());
    return;
  }

  if (action === 'SwitchLast') {
    await switchLastSessionProfile(process.cwd());
    return;
  }

  if (profiles.length === 0) {
    console.log('No profiles configured.');
    return;
  }

  // Start a new session with a profile selector.
  let profilesToSelect = sortedProfiles;

  // For Start action, sort: custom profiles (newest first) then defaults
  if (action === 'Start') {
    const customProfiles = profilesToSelect.filter((p) => !DEFAULT_PROFILES.includes(p));
    const defaultProfiles = profilesToSelect.filter((p) => DEFAULT_PROFILES.includes(p));
    // Custom profiles sorted by creation order (newest first = reverse of config order)
    profilesToSelect = [...customProfiles.reverse(), ...defaultProfiles];
  }

  // Always select first profile
  const initialIndex = 0;

  const profilePrompt = {
    type: 'select',
    name: 'profile',
    message: 'Select a profile to start',
    initial: initialIndex,
    choices: profilesToSelect.map((name) => ({ name, message: name })),
  };

  const profileResult = (await Enquirer.prompt(profilePrompt)) as { profile: string };
  const profileName = profileResult.profile;

  setLastUsedProfile(profileName);

  const confirmPrompt = {
    type: 'confirm',
    name: 'confirm',
    message: `Start new session with ${profileName}?`,
    initial: true,
  };

  const confirmResult = (await Enquirer.prompt(confirmPrompt)) as { confirm: boolean };

  if (!confirmResult.confirm) {
    console.log('Cancelled');
    return;
  }

  const currentCwd = process.cwd();
  let exitCode: number;
  const sessionStartInfo: { sessionKey: string; controllerEndpoint: string } = {
    sessionKey: '',
    controllerEndpoint: '',
  };

  try {
    exitCode = await runCommand(profileName, [], {
      usePty: true,
      onSessionStart: (info) => {
        sessionStartInfo.sessionKey = info.sessionKey;
        sessionStartInfo.controllerEndpoint = info.controllerEndpoint;
        console.log(`\n✨ Session active — key: ${info.sessionKey}`);
        console.log(`   Use: airelay prompt ${info.sessionKey} "your message"\n`);
      },
    });
  } catch (e: unknown) {
    console.error('\nHarness exited with error.');
    console.error('If the terminal display is corrupted, try:');
    console.error('  • Run `reset` command');
    console.error('  • Restart the terminal');
    return;
  }

  console.log('\n');
  const sessionPrompt = {
    type: 'input',
    name: 'sessionId',
    message: 'Session ID to save (or press enter to skip)',
  };
  const sessionResult = (await Enquirer.prompt(sessionPrompt)) as { sessionId: string };
  if (sessionResult.sessionId.trim()) {
    const sessionId = sessionResult.sessionId.trim();
    const defaultKey = `${profileName}_${sessionId.slice(-4)}`;

    const keyPrompt = {
      type: 'input',
      name: 'sessionKey',
      message: 'Session key',
      initial: defaultKey,
    };
    const keyResult = (await Enquirer.prompt(keyPrompt)) as { sessionKey: string };

    addSession(
      profileName,
      sessionId,
      currentCwd,
      keyResult.sessionKey.trim(),
      sessionStartInfo.controllerEndpoint || undefined
    );
    console.log(`Session saved: ${keyResult.sessionKey.trim()}`);
  }

  process.exit(exitCode);
}

function formatProjectPath(project: string): string {
  const home = os.homedir();
  if (project === home) {
    return '~';
  }
  if (project.startsWith(`${home}${path.sep}`)) {
    return `~${project.slice(home.length)}`;
  }
  return project;
}
