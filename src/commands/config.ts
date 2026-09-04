import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import YAML from 'yaml';
import { getConfigPath, loadConfig } from '../config/load';
import {
  Config,
  ConfigSchema,
  DEFAULT_HIBERNATE_AFTER,
  DEFAULT_PROMPT_MAX_LENGTH,
  MAX_PROMPT_MAX_LENGTH,
  ProfileSchema,
  UNLIMITED_PROMPT_MAX_LENGTH,
} from '../config/schema';
import { isValidDuration } from '../utils/duration';

const PROMPT_MAX_LENGTH_KEY = 'settings.promptMaxLength';
const HIBERNATE_AFTER_KEY = 'settings.hibernateAfter';
const PROMPT_MAX_LENGTH_DESCRIPTION =
  'Maximum prompt length in Unicode code points before airelay sends the text to a session.';
const HIBERNATE_AFTER_DESCRIPTION =
  'Time without observed session activity before an idle resumable session is hibernated.';
const PROFILE_FIELDS = new Set(['executable', 'cwd', 'args', 'env', 'description', 'createDirs']);
const ARRAY_PROFILE_FIELDS = new Set(['args', 'createDirs']);

function isSensitiveEnvKey(key: string): boolean {
  return /(api[_-]?key|token|secret|password)/i.test(key);
}

function redactConfig(config: Config): Config {
  return {
    ...config,
    profiles: Object.fromEntries(
      Object.entries(config.profiles).map(([name, profile]) => [
        name,
        {
          ...profile,
          env: profile.env
            ? Object.fromEntries(
                Object.entries(profile.env).map(([key, value]) => [
                  key,
                  isSensitiveEnvKey(key) ? '<redacted>' : value,
                ])
              )
            : undefined,
        },
      ])
    ),
  };
}

function parsePromptMaxLength(value: string): number {
  if (value === String(UNLIMITED_PROMPT_MAX_LENGTH)) {
    return UNLIMITED_PROMPT_MAX_LENGTH;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${PROMPT_MAX_LENGTH_KEY} must be a positive integer or -1 (unlimited).`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${PROMPT_MAX_LENGTH_KEY} must be a positive integer or -1 (unlimited).`);
  }
  if (parsed > MAX_PROMPT_MAX_LENGTH) {
    throw new Error(
      `${PROMPT_MAX_LENGTH_KEY} must be between 1 and ${MAX_PROMPT_MAX_LENGTH.toLocaleString('en-US')}, or -1 (unlimited).`
    );
  }
  return parsed;
}

function parseHibernateAfter(value: string): string {
  if (!isValidDuration(value)) {
    throw new Error(
      `${HIBERNATE_AFTER_KEY} must be a duration such as 30s, 5m, or 2h, or off (maximum 30d).`
    );
  }
  return value;
}

function parseYamlValue(value: string, key: string): unknown {
  try {
    return YAML.parse(value);
  } catch (error) {
    throw new Error(`Invalid YAML value for ${key}: ${(error as Error).message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setProfileValue(
  raw: Record<string, unknown>,
  keyParts: string[],
  value: string
): Record<string, unknown> {
  const profileName = keyParts[1];
  const field = keyParts[2];
  if (!profileName || !field) {
    throw new Error(
      'Profile config keys must look like profiles.<profile>.<field> or profiles.<profile>.env.<name>.'
    );
  }

  const profiles = isRecord(raw.profiles) ? raw.profiles : {};
  const existingProfile = profiles[profileName];
  if (!isRecord(existingProfile)) {
    throw new Error(
      `Profile not found: ${profileName}. Use "airelay config list" to see profiles.`
    );
  }
  if (!PROFILE_FIELDS.has(field)) {
    throw new Error(
      `Unknown profile config key "${field}". Supported fields: executable, cwd, args, env, description, createDirs.`
    );
  }

  const profile = { ...existingProfile };
  if (field === 'env' && keyParts.length > 3) {
    const envName = keyParts.slice(3).join('.');
    if (!envName) throw new Error('Environment variable name is required.');
    const env = isRecord(profile.env) ? { ...profile.env } : {};
    env[envName] = value;
    profile.env = env;
  } else {
    if (keyParts.length !== 3) {
      throw new Error(`The config key "${keyParts.slice(0, 3).join('.')}" cannot be nested.`);
    }
    profile[field] =
      ARRAY_PROFILE_FIELDS.has(field) || field === 'env'
        ? parseYamlValue(value, keyParts.join('.'))
        : value;
  }

  const updated = {
    ...raw,
    profiles: {
      ...profiles,
      [profileName]: profile,
    },
  };
  ProfileSchema.parse(profile);
  return updated;
}

function setConfigValue(
  raw: Record<string, unknown>,
  key: string,
  value: string
): Record<string, unknown> {
  if (key === PROMPT_MAX_LENGTH_KEY) {
    const settings = isRecord(raw.settings) ? raw.settings : {};
    return {
      ...raw,
      settings: {
        ...settings,
        promptMaxLength: parsePromptMaxLength(value),
      },
    };
  }

  if (key === HIBERNATE_AFTER_KEY) {
    const settings = isRecord(raw.settings) ? raw.settings : {};
    return {
      ...raw,
      settings: {
        ...settings,
        hibernateAfter: parseHibernateAfter(value),
      },
    };
  }

  const keyParts = key.split('.');
  if (keyParts[0] === 'profiles') {
    return setProfileValue(raw, keyParts, value);
  }

  if (key === 'version') {
    throw new Error('Config key "version" is read-only and cannot be changed.');
  }

  throw new Error(
    `Unknown config key "${key}". Supported keys: ${PROMPT_MAX_LENGTH_KEY}, ${HIBERNATE_AFTER_KEY} and profiles.<profile>.<field>.`
  );
}

function readRawConfig(configPath: string): Record<string, unknown> {
  const raw = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Config file must contain a YAML object: ${configPath}`);
  }
  return raw as Record<string, unknown>;
}

function writeConfigAtomically(configPath: string, config: Record<string, unknown>): void {
  const temporaryPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    fs.writeFileSync(temporaryPath, YAML.stringify(config), 'utf-8');
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Keep the original error; cleanup is best effort.
    }
    throw error;
  }
}

export function configListCommand(json = false): void {
  const configPath = getConfigPath();
  const config = redactConfig(loadConfig(configPath));

  if (json) {
    console.log(JSON.stringify({ path: configPath, config }, null, 2));
    return;
  }

  console.log(`Config: ${configPath}`);
  console.log(YAML.stringify(config));
}

export function configSetCommand(key: string, value: string): void {
  const configPath = getConfigPath();
  loadConfig(configPath);
  const raw = readRawConfig(configPath);
  const updated = setConfigValue(raw, key, value);

  ConfigSchema.parse(updated);
  writeConfigAtomically(configPath, updated);
  console.log(`Set ${key} in ${configPath}`);
}

export function configHelpCommand(): void {
  console.log(
    [
      'airelay config - read or update airelay settings',
      '',
      'Usage:',
      '  airelay config list                   Show config and resolved defaults',
      '  airelay config list --json            Show config as JSON',
      `  airelay config set ${PROMPT_MAX_LENGTH_KEY} -1`,
      `  airelay config set ${HIBERNATE_AFTER_KEY} 5m`,
      '  airelay config set profiles.my-profile.cwd ~/git/project',
      `  airelay config set profiles.my-profile.args '["--verbose"]'`,
      '  airelay config set profiles.my-profile.env.HARNESS_HOME ~/.airelay-profile',
      '',
      'Supported config keys:',
      `  ${PROMPT_MAX_LENGTH_KEY}`,
      `    ${PROMPT_MAX_LENGTH_DESCRIPTION}`,
      `    Default: ${DEFAULT_PROMPT_MAX_LENGTH}; value: positive integer or -1 (unlimited).`,
      '    Counting uses Unicode code points (Array.from); emoji count as one, combining marks count separately.',
      `  ${HIBERNATE_AFTER_KEY}`,
      `    ${HIBERNATE_AFTER_DESCRIPTION}`,
      `    Default: ${DEFAULT_HIBERNATE_AFTER}; value: <number><ms|s|m|h|d> or off; maximum 30d.`,
      '  profiles.<profile>.executable     Harness executable command.',
      '  profiles.<profile>.cwd            Working directory for the profile.',
      '  profiles.<profile>.args           Default harness arguments as a YAML/JSON array.',
      '  profiles.<profile>.env.<name>     Profile environment variable as a string.',
      '  profiles.<profile>.env            Environment map as a YAML/JSON object.',
      '  profiles.<profile>.description    Human-readable profile description.',
      '  profiles.<profile>.createDirs     Directories as a YAML/JSON array to create before launch.',
      '  version                           Read-only config schema version.',
      '',
      'Use YAML or JSON syntax for arrays and maps. Changes are validated against the config schema.',
      'Config path:',
      `  ${path.join('~', '.airelay', 'config.yaml')} (or AIRELAY_CONFIG)`,
      '',
      'Secrets in environment values are redacted by config list.',
    ].join('\n')
  );
}
