import { Profile } from '../config/schema';
import { expandEnvValue } from '../config/paths';
import { getConfigDir } from '../config/load';

export function buildEnv(profile: Profile, configPath?: string): Record<string, string> {
  const configDir = getConfigDir(configPath);
  const resolvedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) resolvedEnv[key] = value;
  }
  for (const [key, value] of Object.entries(profile.env ?? {})) {
    resolvedEnv[key] = expandEnvValue(key, value, configDir);
  }
  return resolvedEnv;
}
