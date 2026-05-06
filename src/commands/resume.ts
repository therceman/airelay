import { runCommand } from './run';
import { loadConfig } from '../config/load';
import { findSessionByKey, getSessions } from './sessions';
import Enquirer from 'enquirer';

export async function resumeCommand(profileOrSessionKey: string): Promise<void> {
  const found = findSessionByKey(profileOrSessionKey);

  if (found) {
    const session = found.session;
    // Use profileSessionId + profileArgs for restore when available
    const resumeArgs =
      session.profileArgs && session.profileArgs.length > 0
        ? session.profileArgs
        : [`-s`, session.id];

    if (!session.profileSessionId) {
      console.warn(
        'Warning: This session has no profile session metadata. Restoring with internal id.'
      );
      console.warn('Restart the session and save again for better restore support.');
    }

    const exitCode = await runCommand(found.profile, resumeArgs, {
      sessionKey: found.session.sessionKey,
      profileSessionId: session.profileSessionId,
      profileArgs: session.profileArgs,
    });
    process.exit(exitCode);
    return;
  }

  // Not found as session key/ID, check if it's a profile name
  const config = loadConfig();
  if (!config.profiles[profileOrSessionKey]) {
    console.error(`Error: Profile or session not found: ${profileOrSessionKey}`);
    console.error('Usage: airelay resume <profile|session-key>');
    process.exit(1);
  }

  // It's a profile name - show session selector
  const sessions = getSessions(profileOrSessionKey);
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
      message: `${s.id}${keyInfo}${cwdInfo}${pidInfo}`,
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

  const resumeArgs =
    selectedSession.profileArgs && selectedSession.profileArgs.length > 0
      ? selectedSession.profileArgs
      : [`-s`, selectedSession.id];

  if (!selectedSession.profileSessionId) {
    console.warn(
      'Warning: This session has no profile session metadata. Restoring with internal id.'
    );
    console.warn('Restart the session and save again for better restore support.');
  }

  const exitCode = await runCommand(profileOrSessionKey, resumeArgs, {
    sessionKey: selectedSession?.sessionKey,
    profileSessionId: selectedSession.profileSessionId,
    profileArgs: selectedSession.profileArgs,
  });
  process.exit(exitCode);
}
