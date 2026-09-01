import fs from 'fs';
import {
  setupIsolatedHarnessHome,
  getHarnessIsolationConfig,
  listProfileItems,
} from '../utils/harness-isolate';
import { loadConfig } from '../config/load';
import { ensureCodexStandaloneExecutable } from '../utils/codex-standalone';

function showProfileStatus(profileName: string): void {
  const config = loadConfig();
  const profile = config.profiles[profileName] as
    | {
        executable: string;
        env?: { CODEX_HOME?: string };
      }
    | undefined;

  if (!profile) {
    console.log(`Profile '${profileName}' not found.`);
    return;
  }

  const codexHome = profile.env?.CODEX_HOME;
  const isOverlay = codexHome && codexHome.includes('.airelay/codex-');

  console.log(`Profile: ${profileName}`);
  console.log(`  Type:   ${profile.executable}`);
  console.log(`  Layout: ${isOverlay ? 'shared-base overlay' : 'shared (default ~/.codex)'}`);
  console.log(`  Path:   ${codexHome || 'not set'}`);

  if (codexHome && fs.existsSync(codexHome)) {
    const items = listProfileItems(codexHome);
    if (items.length > 0) {
      console.log(`  Contents:`);
      for (const item of items) {
        if (item.type === 'symlink') {
          console.log(`    ${item.name} → ${item.target}`);
        } else {
          console.log(`    ${item.name} (${item.type})`);
        }
      }
    } else {
      console.log(`  Contents: (empty)`);
    }
  }

  const harnessConfig = getHarnessIsolationConfig('codex');
  if (harnessConfig && isOverlay) {
    console.log(`  Layout details:`);
    console.log(`    Local (per-profile): ${harnessConfig.isolatedItems.join(', ') || 'none'}`);
    console.log(
      `    Shared (symlinked):  ${harnessConfig.sharedItems.slice(0, 8).join(', ')}${harnessConfig.sharedItems.length > 8 ? '...' : ''}`
    );
    console.log(`    Shared from:         ~/.codex`);
  }
}

export function isolateCommand(profileName?: string): void {
  const config = loadConfig();

  if (!profileName) {
    // Show all codex profiles with their overlay status
    const codexProfiles = Object.entries(config.profiles)
      .filter(([, p]) => (p as { executable: string }).executable === 'codex')
      .map(([name]) => name);

    if (codexProfiles.length === 0) {
      console.log('No profiles with codex executable found.');
      return;
    }

    console.log('Profiles with codex executable:');
    for (const name of codexProfiles) {
      const profile = config.profiles[name] as { env?: { CODEX_HOME?: string } };
      const codexHome = profile.env?.CODEX_HOME;
      const isOverlay = codexHome && codexHome.includes('.airelay/codex-');
      console.log(`  ${name}${isOverlay ? ' ✓ (overlay)' : ' (shared ~/.codex)'}`);
    }
    console.log('\nUse "airelay isolate <name>" for detailed status or to set up an overlay.');
    return;
  }

  // If profile already has an overlay, show status; otherwise set one up
  const profile = config.profiles[profileName] as
    | {
        executable: string;
        env?: { CODEX_HOME?: string };
      }
    | undefined;

  if (!profile || profile.executable !== 'codex') {
    console.error(`Profile '${profileName}' not found or executable is not 'codex'.`);
    return;
  }

  const codexHome = profile.env?.CODEX_HOME;
  const hasOverlay = codexHome && codexHome.includes('.airelay/codex-');

  if (hasOverlay) {
    // Show detailed status for existing overlay
    showProfileStatus(profileName);
    return;
  }

  // Set up a new shared-base overlay using universal harness isolation
  ensureCodexStandaloneExecutable();
  const newCodexHome = setupIsolatedHarnessHome('codex', profileName);

  console.log(`✓ Profile '${profileName}' (codex) now uses shared-base overlay`);
  console.log(`  Location: ${newCodexHome}`);
  console.log(`  Local (per-profile): auth.json`);
  console.log(`  Shared (symlinked):  memories, policy, rules, sessions, ...`);

  const isolationConfig = getHarnessIsolationConfig('codex');
  if (isolationConfig) {
    console.log(`  Update your config or run the following to use this overlay:`);
    console.log(`  env:`);
    console.log(`    CODEX_HOME: ${newCodexHome}`);
  }
}
