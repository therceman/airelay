import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { getConfigPath, loadConfig } from '../config/load';
import {
  Config,
  ConfigSchema,
  DEFAULT_PROMPT_MAX_LENGTH,
  MAX_PROMPT_MAX_LENGTH,
} from '../config/schema';

const PROMPT_MAX_LENGTH_KEYS = new Set([
  'prompt.maxLength',
  'promptMaxLength',
  'settings.promptMaxLength',
]);

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
  if (!/^\d+$/.test(value)) {
    throw new Error('prompt.maxLength must be a positive integer.');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('prompt.maxLength must be a positive integer.');
  }
  if (parsed > MAX_PROMPT_MAX_LENGTH) {
    throw new Error(
      `prompt.maxLength must be between 1 and ${MAX_PROMPT_MAX_LENGTH.toLocaleString('en-US')}.`
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
}

export function configSetCommand(key: string, value: string): void {
  if (!PROMPT_MAX_LENGTH_KEYS.has(key)) {
    throw new Error(
      `Unknown config key "${key}". Supported keys: prompt.maxLength (alias: settings.promptMaxLength).`
    );
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
  console.log(`Set prompt.maxLength = ${promptMaxLength} in ${configPath}`);
}

export function configHelpCommand(): void {
  console.log(
    [
      'airelay config - read or update airelay settings',
      '',
      'Usage:',
      '  airelay config list                   Show config and resolved defaults',
      '  airelay config list --json            Show config as JSON',
      '  airelay config set prompt.maxLength 512',
      '',
      'Supported settings:',
      `  prompt.maxLength                       Maximum prompt characters (default: ${DEFAULT_PROMPT_MAX_LENGTH})`,
      '',
      'Config path:',
      `  ${path.join('~', '.airelay', 'config.yaml')} (or AIRELAY_CONFIG)`,
      '',
      'Secrets in environment values are redacted by config list.',
    ].join('\n')
  );
}
