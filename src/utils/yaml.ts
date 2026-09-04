import { Profile } from '../config/schema';

export function profileToYaml(name: string, profile: Profile): string {
  let yaml = `  ${name}:\n    executable: ${profile.executable}`;

  if (profile.cwd) {
    yaml += `\n    cwd: ${profile.cwd}`;
  }

  if (profile.description) {
    yaml += `\n    description: ${profile.description}`;
  }

  if (profile.args && profile.args.length > 0) {
    yaml += `\n    args:`;
    for (const arg of profile.args) {
      yaml += `\n      - ${arg}`;
    }
  }

  if (profile.env && Object.keys(profile.env).length > 0) {
    yaml += `\n    env:`;
    for (const [key, value] of Object.entries(profile.env)) {
      yaml += `\n      ${key}: ${value}`;
    }
  }

  if (profile.createDirs && profile.createDirs.length > 0) {
    yaml += `\n    createDirs:`;
    for (const dir of profile.createDirs) {
      yaml += `\n      - ${dir}`;
    }
  }

  return yaml;
}

export function profilesToYaml(profiles: Record<string, Profile>): string {
  return Object.entries(profiles)
    .map(([name, profile]) => profileToYaml(name, profile))
    .join('\n\n');
}
