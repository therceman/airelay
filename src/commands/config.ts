import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { getConfigPath, loadConfig } from '../config/load';
import {
  Config,
  ConfigSchema,
  DEFAULT_PROMPT_MAX_LENGTH,
  MAX_PROMPT_MAX_LENGTH,
  PromptMaxLength,
  UNLIMITED_PROMPT_MAX_LENGTH,
} from '../config/schema';

const PROMPT_MAX_LENGTH_KEY = 'settings.promptMaxLength';
const PROMPT_MAX_LENGTH_DESCRIPTION =
  'Maximum prompt length in Unicode code points before airelay sends the text to a session.';

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

function parsePromptMaxLength(value: string): PromptMaxLength {
  if (value === UNLIMITED_PROMPT_MAX_LENGTH) {
    return UNLIMITED_PROMPT_MAX_LENGTH;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${PROMPT_MAX_LENGTH_KEY} must be a positive integer or "${UNLIMITED_PROMPT_MAX_LENGTH}".`
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `${PROMPT_MAX_LENGTH_KEY} must be a positive integer or "${UNLIMITED_PROMPT_MAX_LENGTH}".`
    );
  }
  if (parsed > MAX_PROMPT_MAX_LENGTH) {
    throw new Error(
      `${PROMPT_MAX_LENGTH_KEY} must be between 1 and ${MAX_PROMPT_MAX_LENGTH.toLocaleString('en-US')}, or "${UNLIMITED_PROMPT_MAX_LENGTH}".`
    );
  }
  return parsed;
}

function readRawConfig(configPath: string): Record<string, unknown> {
  const raw = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Config file must contain a YAML object: ${configPath}`);
  }
  return raw as Record<string, unknown>;
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
  console.log('Setting descriptions:');
  console.log(`  ${PROMPT_MAX_LENGTH_KEY}: ${PROMPT_MAX_LENGTH_DESCRIPTION}`);
  console.log(
    `  Length is measured in Unicode code points (emoji count as one; combining marks count separately).`
  );
  console.log(
    `  Value: positive integer, or "${UNLIMITED_PROMPT_MAX_LENGTH}" to disable this check.`
  );
}

export function configSetCommand(key: string, value: string): void {
  if (key !== PROMPT_MAX_LENGTH_KEY) {
    throw new Error(`Unknown config key "${key}". Supported key: ${PROMPT_MAX_LENGTH_KEY}.`);
  }

  const promptMaxLength = parsePromptMaxLength(value);
  const configPath = getConfigPath();
  loadConfig(configPath);
  const raw = readRawConfig(configPath);
  const rawSettings =
    typeof raw.settings === 'object' && raw.settings !== null && !Array.isArray(raw.settings)
      ? raw.settings
      : {};
  const updated = {
    ...raw,
    settings: {
      ...rawSettings,
      promptMaxLength,
    },
  };

  ConfigSchema.parse(updated);
  fs.writeFileSync(configPath, YAML.stringify(updated), 'utf-8');
  console.log(`Set ${PROMPT_MAX_LENGTH_KEY} = ${promptMaxLength} in ${configPath}`);
}

export function configHelpCommand(): void {
  console.log(
    [
      'airelay config - read or update airelay settings',
      '',
      'Usage:',
      '  airelay config list                   Show config and resolved defaults',
      '  airelay config list --json            Show config as JSON',
      `  airelay config set ${PROMPT_MAX_LENGTH_KEY} 512`,
      `  airelay config set ${PROMPT_MAX_LENGTH_KEY} unlimited`,
      '',
      'Supported settings:',
      `  ${PROMPT_MAX_LENGTH_KEY}`,
      `    ${PROMPT_MAX_LENGTH_DESCRIPTION}`,
      `    Default: ${DEFAULT_PROMPT_MAX_LENGTH}; value: positive integer or ${UNLIMITED_PROMPT_MAX_LENGTH}.`,
      '    Counting uses Unicode code points (Array.from); emoji count as one, combining marks count separately.',
      '',
      'Config path:',
      `  ${path.join('~', '.airelay', 'config.yaml')} (or AIRELAY_CONFIG)`,
      '',
      'Secrets in environment values are redacted by config list.',
    ].join('\n')
  );
}
