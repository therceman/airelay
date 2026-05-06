import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Enquirer from 'enquirer';
import { loadConfig } from '../config/load';
import { migrateLegacyHomeDirIfNeeded } from '../config/migrate';
import { runCommand } from './run';
import { getSessions, addSession, deleteSession, getSessionsPath } from './sessions';
import { createCommandInteractive } from './create-interactive';

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

export async function selectCommand(): Promise<void> {
  const config = loadConfig();
  const profiles = Object.keys(config.profiles).sort();

  const DEFAULT_PROFILES = ['opencode', 'codex'];
  const customProfiles = profiles.filter((p) => !DEFAULT_PROFILES.includes(p));
  const defaultProfiles = profiles.filter((p) => DEFAULT_PROFILES.includes(p));
  const sortedProfiles = [...customProfiles, ...defaultProfiles];

  // Check if any profiles have sessions
  const hasAnySessions = sortedProfiles.some((name) => getSessions(name).length > 0);

  const mainChoices = [
    ...(hasAnySessions ? [{ name: 'Resume', message: 'Resume an existing profile session' }] : []),
    { name: 'Start', message: 'Start a new profile session' },
    { name: 'Create', message: 'Create a new profile' },
  ];

  const mainPrompt = {
    type: 'select',
    name: 'action',
    message: 'Select an option',
    choices: mainChoices,
    initial: 0,
  };

  const mainResult = (await Enquirer.prompt(mainPrompt)) as { action: string };
  const action = mainResult.action;

  if (action === 'Create') {
    await createCommandInteractive();
    return;
  }

  if (profiles.length === 0) {
    console.log('No profiles configured.');
    await createCommandInteractive();
    return;
  }

  // For Resume action, filter to only profiles with sessions
  let profilesToSelect = sortedProfiles;
  if (action === 'Resume') {
    profilesToSelect = sortedProfiles.filter((name) => getSessions(name).length > 0);
  }

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
    message: action === 'Resume' ? 'Select a profile to resume' : 'Select a profile to start',
    initial: initialIndex,
    choices: profilesToSelect.map((name) => {
      const sessions = getSessions(name);
      const sessionsCount = sessions.length > 0 ? ` (${sessions.length} sessions)` : '';
      return {
        name,
        message: `${name}${sessionsCount}`,
      };
    }),
  };

  const profileResult = (await Enquirer.prompt(profilePrompt)) as { profile: string };
  const profileName = profileResult.profile;

  setLastUsedProfile(profileName);

  let selectedSession:
    | { id: string; sessionKey?: string; profileSessionId?: string; profileArgs?: string[] }
    | undefined;
  if (action === 'Resume') {
    const sessions = getSessions(profileName);
    if (sessions.length > 0) {
      const sessionChoices = [
        ...sessions.map((s) => {
          const cwdInfo = s.cwd ? ` ${s.cwd}` : '';
          const keyInfo = s.sessionKey ? ` [${s.sessionKey}]` : '';
          const profileInfo = s.profileSessionId ? ` (profile: ${s.profileSessionId})` : '';
          return {
            name: s.id,
            message: `${s.id}${keyInfo}${cwdInfo}${profileInfo}`,
          };
        }),
        { name: '__rename__', message: '[R] Rename a session' },
        { name: '__delete__', message: '[D] Delete a session' },
      ];

      const enquirer = new Enquirer();
      let sessionResult: { session: string } | undefined;

      const sessionPrompt = {
        type: 'select',
        name: 'session',
        message: 'Select a session to resume',
        choices: sessionChoices,
        initial: 0,
        onRun: function (this: unknown) {
          const selectPrompt = this as {
            on: (event: string, handler: (ch: string, key: { name: string }) => void) => void;
          };
          selectPrompt.on('keypress', (ch, key) => {
            if (key.name === 'r') {
              (this as { cancel: () => void }).cancel();
              sessionResult = { session: '__rename__' };
            } else if (key.name === 'd') {
              (this as { cancel: () => void }).cancel();
              sessionResult = { session: '__delete__' };
            }
          });
        },
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          sessionResult = (await enquirer.prompt(sessionPrompt)) as { session: string };
        } catch (e) {
          if (
            sessionResult &&
            (sessionResult.session === '__rename__' || sessionResult.session === '__delete__')
          ) {
            // Handled by keypress
          } else {
            throw e;
          }
        }

        if (sessionResult.session === '__rename__') {
          const renamePrompt = {
            type: 'select',
            name: 'rename',
            message: 'Select session to rename',
            choices: sessions.map((s) => ({
              name: s.id,
              message: s.sessionKey || s.id,
            })),
          };
          const renameResult = (await enquirer.prompt(renamePrompt)) as { rename: string };

          const namePrompt = {
            type: 'input',
            name: 'name',
            message: 'New key for session',
            initial: sessions.find((s) => s.id === renameResult.rename)?.sessionKey || '',
          };
          const nameResult = (await enquirer.prompt(namePrompt)) as { name: string };

          if (nameResult.name.trim()) {
            const sessionsData = JSON.parse(fs.readFileSync(getSessionsPath(), 'utf-8'));
            const entry = sessionsData[profileName]?.find(
              (s: { id: string }) => s.id === renameResult.rename
            );
            if (entry) {
              entry.sessionKey = nameResult.name.trim();
              fs.writeFileSync(getSessionsPath(), JSON.stringify(sessionsData, null, 2));
              console.log(`Session key updated to: ${nameResult.name.trim()}`);
            }
          }
          continue;
        }

        if (sessionResult.session === '__delete__') {
          const deletePrompt = {
            type: 'select',
            name: 'delete',
            message: 'Select session to delete',
            choices: sessions.map((s) => ({
              name: s.id,
              message: s.sessionKey || s.id,
            })),
          };
          const deleteResult = (await enquirer.prompt(deletePrompt)) as { delete: string };

          const confirmPrompt = {
            type: 'confirm',
            name: 'confirm',
            message: `Delete session "${sessions.find((s) => s.id === deleteResult.delete)?.sessionKey || deleteResult.delete}"?`,
            initial: false,
          };
          const confirmResult = (await enquirer.prompt(confirmPrompt)) as { confirm: boolean };

          if (confirmResult.confirm) {
            deleteSession(profileName, deleteResult.delete);
            console.log('Session deleted');
            sessions.splice(
              sessions.findIndex((s) => s.id === deleteResult.delete),
              1
            );
          }
          continue;
        }

        const sessionValue = sessionResult?.session;
        if (sessionValue) {
          const foundSession = sessions.find((s) => s.id === sessionValue);
          if (foundSession) {
            selectedSession = foundSession;
            break;
          }
        }
      }
    }
  }

  const confirmPrompt = {
    type: 'confirm',
    name: 'confirm',
    message: `${action} ${profileName}${selectedSession ? ` (session: ${selectedSession.sessionKey || selectedSession.id})` : ''}?`,
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
    const resumeArgs = selectedSession
      ? selectedSession.profileArgs && selectedSession.profileArgs.length > 0
        ? selectedSession.profileArgs
        : [`-s`, selectedSession.profileSessionId || selectedSession.id]
      : [];
    exitCode = await runCommand(profileName, resumeArgs, {
      sessionKey: selectedSession?.sessionKey,
      profileSessionId: selectedSession?.profileSessionId,
      profileArgs: selectedSession?.profileArgs,
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
