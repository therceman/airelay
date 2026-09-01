/**
 * Harness-specific configuration for profile isolation.
 * Defines which files/folders should be isolated vs shared.
 */

export interface HarnessIsolationConfig {
  /**
   * Environment variable name for the harness home directory
   * e.g., 'CODEX_HOME', 'OPENCODE_CONFIG_DIR'
   */
  homeEnvVar: string;

  /**
   * Default base directory (e.g., ~/.codex, ~/.config/opencode)
   */
  defaultBaseDir: string;

  /**
   * Files and folders to ALWAYS isolate (copy/create fresh, never symlink)
   * These are profile-specific and should NOT be shared.
   */
  isolatedItems: string[];

  /**
   * Files and folders to share via symlinks to base directory
   * These are common across all profiles of this harness.
   */
  sharedItems: string[];

  /**
   * Items to ignore (neither isolate nor symlink)
   */
  ignoreItems?: string[];
}

/**
 * Harness isolation configurations.
 * Add new harnesses here to support profile isolation.
 */
export const HARNESS_ISOLATION_CONFIGS: Record<string, HarnessIsolationConfig> = {
  codex: {
    homeEnvVar: 'CODEX_HOME',
    defaultBaseDir: '~/.codex',

    // Auth is the ONLY thing we want to isolate
    isolatedItems: ['auth.json'],

    // Share valuable data, exclude transient/regenerable items
    sharedItems: [
      // Folders - persistent data only
      'memories',
      'policy',
      'rules',
      'sessions',
      'shell_snapshots',
      'skills',
      'playground',
      'plugins',
      // The /agents dashboard requires this managed binary layout.
      'packages',
      // File patterns - match by extension
      '*.json',
      '*.toml',
      '*.jsonl',
      '*.sqlite',
      '*.sqlite-shm',
      '*.sqlite-wal',
      '*.sqlite-journal',
      // Specific files (no extension or dotfiles)
      'installation_id',
      '.personality_migration',
    ],

    // Explicitly excluded (each profile gets its own):
    // - cache/ (regenerable)
    // - log/ (profile-specific debugging)
    // - tmp/, .tmp/ (temporary files)
  },

  opencode: {
    homeEnvVar: 'OPENCODE_CONFIG_DIR',
    defaultBaseDir: '~/.config/opencode',

    // Opencode typically shares everything (no per-profile isolation needed)
    // But if needed, you could isolate API keys or specific configs
    isolatedItems: [],

    sharedItems: [
      // Add items here if opencode needs isolation support in future
    ],
  },
};

/**
 * Get isolation config for a harness.
 * @param harnessName - e.g., 'codex', 'opencode'
 * @returns Isolation config or undefined if harness not supported
 */
export function getHarnessIsolationConfig(harnessName: string): HarnessIsolationConfig | undefined {
  return HARNESS_ISOLATION_CONFIGS[harnessName.toLowerCase()];
}

/**
 * Check if a harness supports profile isolation.
 * @param harnessName - e.g., 'codex', 'opencode'
 * @returns true if isolation is supported
 */
export function supportsIsolation(harnessName: string): boolean {
  const config = getHarnessIsolationConfig(harnessName);
  return config !== undefined && (config.isolatedItems.length > 0 || config.sharedItems.length > 0);
}
