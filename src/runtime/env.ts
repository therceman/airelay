import { Profile } from '../config/schema';
import { expandEnvValue } from '../config/paths';
import { getConfigDir } from '../config/load';

const WORKSPACE_ENV_KEYS = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'LANG',
  'LANGUAGE',
  'TZ',
  'LC_ALL',
  'LC_CTYPE',
  'LC_COLLATE',
  'LC_MESSAGES',
  'LC_MONETARY',
  'LC_NUMERIC',
  'LC_TIME',
  'LC_PAPER',
  'LC_MEASUREMENT',
  'LC_IDENTIFICATION',
  'LC_NAME',
  'LC_ADDRESS',
  'LC_TELEPHONE',
  'WT_SESSION',
  'AIRELAY_CONFIG',
  'AIRELAY_SESSIONS',
  'AIRELAY_HISTORY',
  'AIRELAY_LAST_USED',
  'AIRELAY_PIDS',
  'AIRELAY_SOCKETS_DIR',
  'AIRELAY_TRANSCRIPTS_DIR',
  'AIRELAY_DETACHED',
  'AIRELAY_DETACHED_RECEIPTS_DIR',
]);

function isWorkspaceEnvKey(key: string): boolean {
  return WORKSPACE_ENV_KEYS.has(key);
}

export function buildEnv(
  profile: Profile,
  configPath?: string,
  managed = false
): Record<string, string> {
  const configDir = getConfigDir(configPath);
  const resolvedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (!managed || isWorkspaceEnvKey(key))) {
      resolvedEnv[key] = value;
    }
  }

  if (profile.env) {
    for (const [key, value] of Object.entries(profile.env)) {
      if (managed && (!isWorkspaceEnvKey(key) || ['HOME', 'USER', 'LOGNAME'].includes(key))) {
        throw new Error(
          `Environment override ${key} is not supported for managed workspaces; use native provider login.`
        );
      }
      resolvedEnv[key] = expandEnvValue(key, value, configDir);
    }
  }

  return resolvedEnv;
}
