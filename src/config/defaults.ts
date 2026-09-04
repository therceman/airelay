import os from 'os';
import path from 'path';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.airelay');
export const DEFAULT_CONFIG_FILE = path.join(DEFAULT_CONFIG_DIR, 'config.yaml');

export const STARTER_CONFIG = `version: 1

settings:
  promptMaxLength: 512

profiles:
  opencode-work:
    executable: opencode
    cwd: ~/git/work
    description: Work profile for opencode
    env:
      OPENCODE_CONFIG_DIR: ~/.config/opencode-work
      XDG_CONFIG_HOME: ~/.airelay/opencode-work/config
      XDG_DATA_HOME: ~/.airelay/opencode-work/data

  codex-personal:
    executable: codex
    cwd: ~/git/personal
    description: Personal profile for codex
    args:
      - --sandbox
      - workspace-write
    env:
      CODEX_HOME: ~/.codex-personal
`;
