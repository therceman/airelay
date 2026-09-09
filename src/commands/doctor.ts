import { loadConfig, getConfigPath } from '../config/load';
import { resolveExecutable } from '../runtime/resolveExecutable';
import { expandTilde } from '../config/paths';
import { Profile } from '../config/schema';
import fs from 'fs';

export interface DoctorResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function doctorCommand(profileName?: string): DoctorResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('Config file not found')) {
      errors.push(
        `Config file not found: ${getConfigPath()}\nRun 'airelay init' to create a config.`
      );
    } else {
      errors.push(`Config error: ${msg}`);
    }
    return { ok: false, errors, warnings };
  }

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    errors.push(`Config file not found: ${configPath}\nRun 'airelay init' to create a config.`);
    return { ok: false, errors, warnings };
  }

  const profiles = profileName ? { [profileName]: config.profiles[profileName] } : config.profiles;

  for (const [name, profile] of Object.entries(profiles)) {
    const p = profile as Profile | undefined;
    if (!p) {
      errors.push(`Profile not found: ${name}`);
      continue;
    }

    if (isLegacyInitCodexProfile(name, p)) {
      warnings.push(
        `Profile ${name}: uses the legacy init-generated CODEX_HOME at ${expandTilde(p.env!.CODEX_HOME!)}. ` +
          'The native shared profile should omit CODEX_HOME. Run ' +
          '`airelay config unset profiles.codex.env.CODEX_HOME` to use ~/.codex. ' +
          'The old profile directory is not removed automatically.'
      );
    }

    if (!p.executable) {
      errors.push(`Profile ${name}: missing executable`);
    } else {
      const execPath = resolveExecutable(p.executable);
      if (!execPath) {
        errors.push(
          `Profile ${name}: executable not found in PATH: ${p.executable}\nInstall the executable or update the profile.`
        );
      }
    }

    if (p.cwd) {
      const resolved = expandTilde(p.cwd);
      const parent = resolved.substring(
        0,
        resolved.lastIndexOf(process.platform === 'win32' ? '\\' : '/')
      );
      if (!fs.existsSync(parent)) {
        errors.push(`Profile ${name}: parent directory does not exist: ${parent}`);
      }
    }

    if (p.createDirs) {
      for (const dir of p.createDirs) {
        const resolved = expandTilde(dir);
        if (fs.existsSync(resolved)) {
          if (!isWritable(resolved)) {
            errors.push(`Profile ${name}: directory not writable: ${resolved}`);
          }
        }
      }
    }

    if (p.env) {
      for (const [key, value] of Object.entries(p.env)) {
        if (key.includes('HOME') || key.includes('DIR') || key.includes('DATA')) {
          const resolved = expandTilde(value);
          const parent = resolved.substring(
            0,
            resolved.lastIndexOf(process.platform === 'win32' ? '\\' : '/')
          );
          if (!fs.existsSync(parent)) {
            errors.push(`Profile ${name}: env ${key} parent directory does not exist: ${parent}`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isLegacyInitCodexProfile(name: string, profile: Profile): boolean {
  const configuredHome = profile.env?.CODEX_HOME;
  if (name !== 'codex' || profile.executable !== 'codex' || !configuredHome) {
    return false;
  }

  return expandTilde(configuredHome) === expandTilde('~/.airelay/codex');
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
