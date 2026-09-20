import fs from 'fs';
import path from 'path';
import { runCommand } from '../src/commands/run';
import { useTestEnv } from './test-utils';

const testEnv = useTestEnv();

const DEVIN_TRUST_SCREEN = [
  '✱ Do you trust the authors of this directory?',
  'For security, devin should not be run in directories with untrusted content.',
  '~/git/example',
  '❭ 1 Yes, trust',
  '· 2 No, exit',
  '↓↑ to select · ↵ to choose · esc to quit',
].join('\r\n');
const CODEX_TRUST_SCREEN = [
  '> You are in /home/agent/project',
  '',
  'Do you trust the contents of this directory? Working with untrusted content',
  'comes with higher risk of prompt injection. Trusting the directory allows',
  'project-local config, hooks, and exec policies to load.',
  '› 1. Yes, continue',
  '  2. No, quit',
  'Press enter to continue',
].join('\r\n');

function writeTrustHarness(
  harnessPath: string,
  inputLogPath: string,
  argsPath: string,
  screen: string
): void {
  fs.writeFileSync(
    harnessPath,
    `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdout.write(${JSON.stringify(screen)} + '\\r\\n');
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(${JSON.stringify(inputLogPath)}, chunk.toString());
  if (chunk.includes('\\r') || chunk.includes('\\n')) {
    process.stdout.write('SWE-1.7 Medium Context: 11k / 1.0M tokens (1%)\\r\\n');
    setTimeout(() => process.exit(0), 10);
  }
});
setTimeout(() => process.exit(0), 250);
`
  );
  fs.chmodSync(harnessPath, 0o755);
}

describe('explicit workspace trust bypass', () => {
  it('auto-confirms the exact Devin trust screen once and passes native bypass args', async () => {
    const harnessPath = path.join(testEnv.testDir, 'devin-trust-harness');
    const inputLogPath = path.join(testEnv.testDir, 'devin-trust-input.log');
    const argsPath = path.join(testEnv.testDir, 'devin-trust-args.json');
    writeTrustHarness(harnessPath, inputLogPath, argsPath, DEVIN_TRUST_SCREEN);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { trust_test: { executable: harnessPath, args: ['--permission-mode', 'smart'] } },
      })
    );

    await expect(
      runCommand('trust_test', [], {
        usePty: true,
        detached: true,
        bypass: true,
        sessionKey: 'trust_bypass_test',
      })
    ).resolves.toBe(0);

    expect(fs.readFileSync(inputLogPath, 'utf8')).toBe('\r');
    expect(JSON.parse(fs.readFileSync(argsPath, 'utf8'))).toEqual(['--permission-mode', 'bypass']);
  }, 10000);

  it('auto-confirms Codex trust only with the explicit bypass launch flag', async () => {
    const harnessPath = path.join(testEnv.testDir, 'codex-trust-harness');
    const inputLogPath = path.join(testEnv.testDir, 'codex-trust-input.log');
    const argsPath = path.join(testEnv.testDir, 'codex-trust-args.json');
    writeTrustHarness(harnessPath, inputLogPath, argsPath, CODEX_TRUST_SCREEN);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { trust_test: { executable: harnessPath } },
      })
    );

    await expect(
      runCommand('trust_test', [], {
        usePty: true,
        detached: true,
        bypass: true,
        sessionKey: 'codex_trust_bypass_test',
      })
    ).resolves.toBe(0);

    expect(fs.readFileSync(inputLogPath, 'utf8')).toBe('\r');
    expect(JSON.parse(fs.readFileSync(argsPath, 'utf8'))).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  }, 10000);

  it('does not accept the same screen without explicit --bypass', async () => {
    const harnessPath = path.join(testEnv.testDir, 'devin-trust-harness-no-bypass');
    const inputLogPath = path.join(testEnv.testDir, 'devin-no-bypass-input.log');
    const argsPath = path.join(testEnv.testDir, 'devin-no-bypass-args.json');
    writeTrustHarness(harnessPath, inputLogPath, argsPath, DEVIN_TRUST_SCREEN);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { trust_test: { executable: harnessPath } },
      })
    );

    await expect(
      runCommand('trust_test', [], {
        usePty: true,
        detached: true,
        sessionKey: 'trust_no_bypass_test',
      })
    ).resolves.toBe(0);

    expect(fs.existsSync(inputLogPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(argsPath, 'utf8'))).toEqual([]);
  }, 10000);

  it('rejects bypass for unsupported harnesses instead of silently ignoring it', async () => {
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', harnessSelfUpdate: true },
        profiles: { open_code: { executable: 'opencode' } },
      })
    );

    await expect(runCommand('open_code', [], { usePty: true, bypass: true })).rejects.toThrow(
      '--bypass is not supported for the opencode harness'
    );
  });
});
