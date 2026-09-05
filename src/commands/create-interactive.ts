import fs from 'fs';
import os from 'os';
import path from 'path';
import Enquirer from 'enquirer';
import { getConfigPath, loadConfig } from '../config/load';
import {
  DEFAULT_HIBERNATE_AFTER,
  DEFAULT_HARNESS_SELF_UPDATE,
  DEFAULT_PROMPT_MAX_LENGTH,
  Profile,
  ProfileSchema,
  PromptMaxLength,
} from '../config/schema';
import { profileToYaml } from '../utils/yaml';
import { detectHarness } from '../utils/harness';
import { detectAvailableHarnesses } from '../utils/detect-harnesses';
import {
  setupIsolatedHarnessHome,
  repairIsolatedHarnessHome,
  getHarnessIsolationConfig,
} from '../utils/harness-isolate';
import { ensureCodexStandaloneExecutable } from '../utils/codex-standalone';
import { withAirelayPromptSymbols } from '../utils/enquirer';

interface CreateOptions {
  name?: string;
  executable?: string;
  apiKey?: string;
  customDir?: string;
  force?: boolean;
}

export async function createCommandInteractive(opts: CreateOptions = {}): Promise<void> {
  let name = opts.name;
  let execName = opts.executable;
  let configDir = opts.customDir;
  let apiKeyVal = opts.apiKey;

  if (!name) {
    const namePrompt = {
      type: 'input',
      name: 'name',
      message: 'Profile name',
      validate: (value: string) => {
        if (!value.trim()) return 'Profile name is required';
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
          return 'Profile name must start with a letter and contain only letters, numbers, -, and _';
        }
        return true;
      },
    };
    const nameResult = (await Enquirer.prompt(withAirelayPromptSymbols(namePrompt))) as {
      name: string;
    };
    name = nameResult.name.trim();
  }

  const configPath = getConfigPath();
  let configProfiles: Record<string, unknown>;
  let promptMaxLength: PromptMaxLength = DEFAULT_PROMPT_MAX_LENGTH;
  let hibernateAfter = DEFAULT_HIBERNATE_AFTER;
  let harnessSelfUpdate = DEFAULT_HARNESS_SELF_UPDATE;

  try {
    const existingConfig = loadConfig();
    configProfiles = existingConfig.profiles;
    promptMaxLength = existingConfig.settings?.promptMaxLength ?? DEFAULT_PROMPT_MAX_LENGTH;
    hibernateAfter = existingConfig.settings.hibernateAfter;
    harnessSelfUpdate = existingConfig.settings.harnessSelfUpdate;
  } catch {
    configProfiles = {};
  }

  if (configProfiles[name] && opts.force !== true) {
    const confirmPrompt = {
      type: 'confirm',
      name: 'overwrite',
      message: `Profile '${name}' already exists. Overwrite?`,
      initial: false,
    };
    const confirmResult = (await Enquirer.prompt(withAirelayPromptSymbols(confirmPrompt))) as {
      overwrite: boolean;
    };
    if (!confirmResult.overwrite) {
      console.log('Cancelled');
      return;
    }
  }

  if (!execName) {
    const available = detectAvailableHarnesses();

    // Auto-select harness if profile name starts with a harness executable name
    const lowerName = name!.toLowerCase();
    const autoMatch = available.find((h) => lowerName.startsWith(h.executable.toLowerCase()));

    if (autoMatch) {
      execName = autoMatch.executable;
      console.log(`Auto-selected executable: ${execName}`);
    } else {
      const choices = available.map((h) => ({
        name: h.executable,
        message: h.executable,
      }));

      const execPrompt = {
        type: 'select',
        name: 'executable',
        message: 'Select executable',
        choices,
        initial: available.findIndex((h) => h.available) >= 0 ? 0 : 0,
      };
      const execResult = (await Enquirer.prompt(withAirelayPromptSymbols(execPrompt))) as {
        executable: string;
      };
      execName = execResult.executable;
    }
  }

  const harness = detectHarness(execName);

  // Check if harness supports isolation
  const isolationConfig = getHarnessIsolationConfig(harness);

  if (
    isolationConfig &&
    (isolationConfig.isolatedItems.length > 0 || isolationConfig.sharedItems.length > 0)
  ) {
    if (harness === 'codex') {
      ensureCodexStandaloneExecutable();
    }
    // Set up shared-base overlay with local-only auth
    configDir = setupIsolatedHarnessHome(harness, name);

    // Repair existing overlay: remove stale non-auth entries, rebuild symlinks
    repairIsolatedHarnessHome(harness, name, configDir);

    console.log(`Created ${harness} profile overlay at: ${configDir}`);

    if (isolationConfig.isolatedItems.length > 0) {
      console.log(`  - Local (per-profile): ${isolationConfig.isolatedItems.join(', ')}`);
    }
    if (isolationConfig.sharedItems.length > 0) {
      console.log(
        `  - Shared (symlinked from ~/.codex): ${isolationConfig.sharedItems.slice(0, 5).join(', ')}...`
      );
    }
  } else if (harness === 'opencode') {
    // Opencode uses shared config by default
    configDir = path.join(os.homedir(), '.config', 'opencode');
  } else {
    // Other harnesses get isolated config
    configDir = path.join(os.homedir(), '.airelay', 'profiles', name, 'config');
  }

  if (!apiKeyVal) {
    if (harness === 'codex') {
      console.log('Note: codex has built-in login (run: codex login)');
    } else if (harness === 'opencode') {
      const apiKeyPrompt = {
        type: 'input',
        name: 'apiKey',
        message: 'OPENCODE_API_KEY (optional, press enter to skip)',
      };
      const apiKeyResult = (await Enquirer.prompt(withAirelayPromptSymbols(apiKeyPrompt))) as {
        apiKey: string;
      };
      apiKeyVal = apiKeyResult.apiKey;
    }
  }

  const profile: Record<string, unknown> = {
    executable: execName,
    env: {},
  };

  // Set CODEX_HOME for codex (opencode uses shared, no env var needed)
  if (harness === 'codex' && configDir) {
    (profile.env as Record<string, string>)['CODEX_HOME'] = configDir;

    // Create the codex config directory
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  if (apiKeyVal && harness === 'opencode') {
    (profile.env as Record<string, string>)['OPENCODE_API_KEY'] = apiKeyVal;
  }

  configProfiles[name] = profile;

  const typedProfiles: Record<string, Profile> = {};
  for (const [n, p] of Object.entries(configProfiles)) {
    const prof = p as Record<string, unknown>;
    typedProfiles[n] = ProfileSchema.parse({
      executable: prof.executable,
      cwd: prof.cwd,
      description: prof.description,
      env: prof.env,
      createDirs: prof.createDirs,
      args: prof.args,
    });
  }
  const profileYaml = Object.entries(typedProfiles)
    .map(([n, p]) => profileToYaml(n, p))
    .join('\n\n');
  const yamlContent = `version: 1\n\nsettings:\n  promptMaxLength: ${promptMaxLength}\n  hibernateAfter: ${hibernateAfter}\n  harnessSelfUpdate: ${harnessSelfUpdate}\n\nprofiles:\n${profileYaml}\n`;

  fs.writeFileSync(configPath, yamlContent, 'utf-8');

  console.log(`\nCreated profile '${name}' in ${configPath}`);
  console.log(`Config directory: ${configDir}`);
  console.log(`\nUsage: airelay start ${name}`);
}
