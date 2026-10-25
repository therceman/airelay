import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { Config, ConfigSchema } from './schema';
import { DEFAULT_CONFIG_FILE } from './defaults';
import { migrateLegacyHomeDirIfNeeded } from './migrate';

export function getConfigPath(): string {
  if (!process.env.AIRELAY_CONFIG) {
    migrateLegacyHomeDirIfNeeded();
  }
  return process.env.AIRELAY_CONFIG || DEFAULT_CONFIG_FILE;
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || getConfigPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (e) {
    throw new Error(`Invalid YAML in config file: ${(e as Error).message}`);
  }

  if (parsed && typeof parsed === 'object' && 'profiles' in parsed) {
    const profiles = (parsed as { profiles?: Record<string, unknown> }).profiles;
    if (
      profiles &&
      Object.values(profiles).some((p) => p && typeof p === 'object' && 'workspace' in p)
    )
      throw new Error(
        'Profile-bound workspaces are retired. Run airelay workspace migrate-profiles --dry-run, then migrate unused generated profiles; use start --workspace.'
      );
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Config validation failed: ${issues}`);
  }

  return result.data as Config;
}

export function getConfigDir(configPath?: string): string {
  const filePath = configPath || getConfigPath();
  return path.dirname(filePath);
}
