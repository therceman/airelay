import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { buildEnv } from '../src/runtime/env';
import { buildProfileEnv, runCommand } from '../src/commands/run';
import { workspaceCommand } from '../src/commands/workspace';
import { Profile } from '../src/config/schema';
import { resolveSessionWorkspace } from '../src/workspace/binding';
import {
  provisionWorkspace,
  verifyWorkspaceFiles,
  workspacePath,
} from '../src/workspace/provision';
import { validateWorkspaceArgs, verifyNativeWorkspace } from '../src/workspace/verify';
import { useTestEnv } from './test-utils';
import { getSameHarnessProfiles } from '../src/commands/resume';
import { fetchControllerInfo, sendControllerRequest } from '../src/commands/session-ipc';
import {
  backupWorkspaceConfiguration,
  restoreWorkspaceConfiguration,
} from '../src/workspace/backup';

const testEnv = useTestEnv();
let root: string;
let instructions: string;
let skillsDir: string;
let caseDirectory: string;
let caseIndex = 0;

beforeEach(() => {
  caseDirectory = path.join(testEnv.testDir, `case-${caseIndex++}`);
  fs.mkdirSync(caseDirectory);
  root = path.join(caseDirectory, 'workspaces');
  instructions = path.join(caseDirectory, 'agent-instructions.md');
  skillsDir = path.join(caseDirectory, 'agent-skills');
  fs.writeFileSync(instructions, '# Worker\nFollow the approved project instructions.\n');
  fs.mkdirSync(path.join(skillsDir, 'worker-guide'), { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, 'worker-guide', 'SKILL.md'),
    '---\nname: worker-guide\ndescription: Project worker guidance.\n---\nUse only the bound MCP identity.\n'
  );
  fs.writeFileSync(
    testEnv.configPath,
    JSON.stringify({
      version: 1,
      settings: { hibernateAfter: 'off', workspaceRoot: root },
      profiles: { existing: { executable: 'node' } },
    })
  );
});

function provisionAgent() {
  const result = provisionWorkspace({ project: 'test', agent: 'worker', root });
  if (result.changed.length) {
    fs.copyFileSync(instructions, path.join(result.directory, 'AGENTS.md'));
    fs.cpSync(skillsDir, path.join(result.directory, '.devin/skills'), { recursive: true });
  }
  return result;
}
function mcpFile(name: string, credential: string): string {
  const file = path.join(testEnv.testDir, `${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      mcpServers: { 'test-mcp': { command: '/bin/false', env: { TEST_CREDENTIAL: credential } } },
    }),
    { mode: 0o600 }
  );
  return file;
}

describe('agent-only Workspace provisioning', () => {
  it('backs up and restores permissions, hashes and links without exposing credentials', () => {
    const file = mcpFile('backup-fixture', 'dummy-private-credential');
    const link = path.join(caseDirectory, 'config-link');
    fs.symlinkSync(file, link);
    const backup = path.join(caseDirectory, 'backup');
    const before = fs.readFileSync(file);
    const manifest = backupWorkspaceConfiguration([file, link], backup);
    expect(fs.statSync(backup).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(manifest, 'utf8')).not.toContain('dummy-private-credential');
    fs.writeFileSync(file, '{}');
    fs.unlinkSync(link);
    restoreWorkspaceConfiguration(backup);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readlinkSync(link)).toBe(file);
  });
  it('creates project/agents/agent, stays idempotent and never copies the source checkout', () => {
    const source = path.join(caseDirectory, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'do-not-copy'), 'SOURCE');
    const options = { project: 'test', agent: 'worker', root, source };
    const created = provisionWorkspace(options);
    expect(created.directory).toBe(path.join(root, 'test/agents/worker'));
    expect(fs.existsSync(path.join(created.directory, 'do-not-copy'))).toBe(false);
    expect(fs.readFileSync(path.join(created.directory, 'AGENTS.md'), 'utf8')).toContain(source);
    expect(fs.existsSync(path.join(root, 'test/roles'))).toBe(false);
    const before = fs.statSync(path.join(created.directory, 'AGENTS.md')).mtimeMs;
    expect(provisionWorkspace(options).changed).toEqual([]);
    expect(fs.statSync(path.join(created.directory, 'AGENTS.md')).mtimeMs).toBe(before);
    expect(verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root).manifest).toEqual({
      version: 2,
      binding: { project: 'test', agent: 'worker' },
      source,
    });
  });
  it('dry-run does not create Workspace directories or write configuration', () => {
    const before = fs.readFileSync(testEnv.configPath);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      workspaceCommand('provision', ['test.worker'], { 'dry-run': true });
    } finally {
      log.mockRestore();
    }
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.readFileSync(testEnv.configPath)).toEqual(before);
  });
  it.each([
    'role-workspace',
    'principal',
    'instructions',
    'skills-dir',
    'mcp-config',
    'update',
    'dryrun',
  ])('rejects removed or misspelled provisioning flag --%s', (flag) => {
    expect(() => workspaceCommand('provision', ['test.worker'], { [flag]: 'value' })).toThrow(
      'Unknown workspace option'
    );
    expect(fs.existsSync(root)).toBe(false);
  });
  it('rejects valued dry-run flags and obsolete migration actions', () => {
    expect(() => workspaceCommand('provision', ['test.worker'], { 'dry-run': 'true' })).toThrow(
      'does not take'
    );
    expect(() => workspaceCommand('migrate-profiles', [], {})).toThrow('Usage');
  });
  it('allows agent-owned instruction and Skill edits without updating a manifest or reprovisioning', () => {
    const agent = provisionAgent();
    const manifest = fs.readFileSync(path.join(agent.directory, '.airelay-workspace.json'));
    fs.writeFileSync(path.join(agent.directory, 'AGENTS.md'), '# User configured instructions');
    fs.writeFileSync(
      path.join(agent.directory, '.devin/skills/worker-guide/SKILL.md'),
      '# Edited Skill'
    );
    fs.writeFileSync(
      path.join(agent.directory, '.devin/skills/worker-guide/notes.md'),
      'Extra agent notes'
    );
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).not.toThrow();
    expect(provisionWorkspace({ project: 'test', agent: 'worker', root }).changed).toEqual([]);
    expect(fs.readFileSync(path.join(agent.directory, '.airelay-workspace.json'))).toEqual(
      manifest
    );
    expect(fs.readFileSync(path.join(agent.directory, 'AGENTS.md'), 'utf8')).toBe(
      '# User configured instructions'
    );
  });
  it('refuses unmanaged directories, traversal and symlinked Workspace paths', () => {
    expect(() => workspacePath({ project: '../foreign', agent: 'lead' }, root)).toThrow();
    const target = path.join(root, 'test/agents/worker');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user.txt'), 'KEEP');
    expect(() => provisionAgent()).toThrow('unmanaged');
    expect(fs.readFileSync(path.join(target, 'user.txt'), 'utf8')).toBe('KEEP');
    fs.symlinkSync(caseDirectory, path.join(root, 'escape'));
    expect(() => provisionWorkspace({ project: 'escape', agent: 'lead', root })).toThrow('symlink');
  });
  it('allows explicit internal asset sharing without any Role assignment but rejects escaping links and cycles', () => {
    const agent = provisionAgent();
    const other = provisionWorkspace({ project: 'test', agent: 'other', root });
    const file = path.join(other.directory, 'AGENTS.md');
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(agent.directory, 'AGENTS.md'), file);
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'other' }, root)).not.toThrow();
    fs.unlinkSync(file);
    fs.symlinkSync(instructions, file);
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'other' }, root)).toThrow(
      'escapes'
    );
    fs.unlinkSync(file);
    fs.writeFileSync(file, '# Other');
    const skills = path.join(other.directory, '.devin/skills');
    fs.symlinkSync(skills, path.join(skills, 'cycle'));
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'other' }, root)).toThrow('cycle');
  });
  it('keeps credentials regular/private, rejects local MCP and config imports', () => {
    const agent = provisionAgent();
    const local = path.join(agent.directory, '.devin/mcp_config.local.json');
    fs.chmodSync(local, 0o644);
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow('0600');
    fs.chmodSync(local, 0o600);
    fs.writeFileSync(local, '{"mcpServers":{"foreign":{"command":"/bin/false"}}}');
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'zero MCP'
    );
    fs.writeFileSync(local, '{"mcpServers":{}}');
    fs.unlinkSync(local);
    fs.symlinkSync('../AGENTS.md', local);
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'symlink'
    );
    fs.unlinkSync(local);
    fs.writeFileSync(local, '{"mcpServers":{}}', { mode: 0o600 });
    fs.writeFileSync(path.join(agent.directory, '.devin/config.json'), '{}');
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'Unmanaged configuration'
    );
  });
  it('bounds asset scans and file sizes', () => {
    const agent = provisionAgent();
    const skills = path.join(agent.directory, '.devin/skills');
    for (let i = 0; i < 257; i++) fs.writeFileSync(path.join(skills, 'extra-' + i), 'x');
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'entry limit'
    );
    fs.rmSync(skills, { recursive: true });
    fs.mkdirSync(skills);
    fs.writeFileSync(path.join(skills, 'huge'), Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'asset limit'
    );
  });
  it('fails closed on obsolete manifests and mismatched Agent identity', () => {
    const agent = provisionAgent();
    const file = path.join(agent.directory, '.airelay-workspace.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, binding: { project: 'test', role: 'worker' } })
    );
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'unsupported'
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 2, binding: { project: 'test', agent: 'other' } })
    );
    expect(() => verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root)).toThrow(
      'does not match'
    );
  });
  it('cleans staged files and the lock if atomic publication fails', () => {
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated publication failure');
    });
    try {
      expect(() => provisionAgent()).toThrow('simulated');
    } finally {
      rename.mockRestore();
    }
    expect(fs.existsSync(path.join(root, 'test/agents/worker'))).toBe(false);
    expect(fs.readdirSync(path.join(root, 'test/agents'))).toEqual([]);
    expect(() => provisionAgent()).not.toThrow();
  });
  it('does not expose malformed secret-bearing MCP contents', () => {
    const agent = provisionAgent();
    fs.writeFileSync(
      path.join(agent.directory, '.devin/mcp_config.local.json'),
      '{"token":"dummy-private-secret", invalid'
    );
    try {
      verifyWorkspaceFiles({ project: 'test', agent: 'worker' }, root);
      throw new Error('Expected failure');
    } catch (error) {
      expect((error as Error).message).toContain('Invalid MCP configuration');
      expect((error as Error).message).not.toContain('dummy-private-secret');
    }
  });
  it('fails closed during an external Workspace maintenance lock without creating a directory', () => {
    const lock = path.join(path.dirname(root), `.${path.basename(root)}.workspace.lock`);
    fs.mkdirSync(lock);
    try {
      expect(() => provisionAgent()).toThrow('operation in progress');
    } finally {
      fs.rmdirSync(lock);
    }
    expect(fs.existsSync(path.join(root, 'test/agents/worker'))).toBe(false);
  });
});

describe('managed environment and launch binding', () => {
  it('keeps same-harness account switching independent of the session workspace', () => {
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        profiles: {
          devin: { executable: 'devin' },
          second: { executable: 'devin' },
          other: { executable: 'codex' },
        },
      })
    );
    expect(getSameHarnessProfiles('devin')).toEqual(['second']);
  });
  it('filters foreign credentials only for managed sessions and preserves native login paths', () => {
    const original = process.env.BB_MCP_TOKEN;
    process.env.BB_MCP_TOKEN = 'dummy-foreign';
    try {
      expect(buildEnv({ executable: 'node' }).BB_MCP_TOKEN).toBe('dummy-foreign');
      const managed = buildEnv({ executable: 'devin' }, undefined, true);
      expect(managed.BB_MCP_TOKEN).toBeUndefined();
      expect(managed.AIRELAY_SESSION_KEY).toBeUndefined();
      expect(managed.HOME).toBe(process.env.HOME);
      expect(managed.PATH).toBe(process.env.PATH);
      expect(() =>
        buildEnv({ executable: 'devin', env: { BB_MCP_TOKEN: 'dummy' } }, undefined, true)
      ).toThrow('not supported');
    } finally {
      if (original === undefined) delete process.env.BB_MCP_TOKEN;
      else process.env.BB_MCP_TOKEN = original;
    }
  });
  it('provisions without creating profiles and resolves a session-level workspace', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const config = fs.readFileSync(testEnv.configPath);
    try {
      workspaceCommand('provision', ['test.worker'], {});
    } finally {
      log.mockRestore();
    }
    expect(fs.readFileSync(testEnv.configPath)).toEqual(config);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { workspaceRoot: root },
        profiles: {
          devin: { executable: 'devin', cwd: testEnv.testDir },
          existing: { executable: 'node' },
        },
      })
    );
    const binding = resolveSessionWorkspace('test.worker', root);
    expect(
      buildProfileEnv('devin', ['--resume', 'native-session'], undefined, undefined, false, binding)
        .cwd
    ).toBe(binding.path);
    expect(() => buildProfileEnv('devin', [], testEnv.testDir, undefined, false, binding)).toThrow(
      'cwd differs'
    );
    expect(buildProfileEnv('existing', [], testEnv.testDir).cwd).toBe(testEnv.testDir);
    expect(() => validateWorkspaceArgs(['--config', '/foreign/config.json'])).toThrow(
      'Unsupported'
    );
  });
});

function fakeDevin(hibernateOnce = false): string {
  const binary = path.join(testEnv.testDir, 'devin');
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const cwd = process.cwd();
if (args[0] === 'mcp') {
 const files = [path.join(process.env.HOME, '.config/devin/mcp_config.json'), path.join(cwd, '.devin/mcp_config.local.json')];
 const servers = Object.assign({}, ...files.map(file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).mcpServers : {}));
 console.log(Object.keys(servers).length ? 'Configured MCP servers' : 'No MCP servers configured.'); for (const name of Object.keys(servers)) console.log('  • ' + name + '\\n    Source: ' + path.join(cwd, '.devin/mcp_config.local.json'));
} else if (args[0] === 'skills') {
 const root = path.join(cwd, '.devin/skills'); console.log(JSON.stringify(fs.readdirSync(root).map(name => ({name, provider: 'Devin', base_dir: path.join(root, name)}))));
} else if (args[0] === 'rules') console.log(args[1] === 'list' ? 'Available rules\\n\\n  AGENTS [Standard] always-on' : fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'));
else {
 const log = ${JSON.stringify(path.join(testEnv.testDir, 'launch.json'))};
 const history = ${JSON.stringify(path.join(caseDirectory, 'launches.jsonl'))};
 const launch = JSON.stringify({cwd, args, envKeys: Object.keys(process.env)});
 const count = fs.existsSync(history) ? fs.readFileSync(history, 'utf8').trim().split('\\n').length : 0;
 fs.writeFileSync(log, launch); fs.appendFileSync(history, launch + '\\n');
 if (${hibernateOnce} && count === 0) { process.stdout.write('Ask Devin to build features, fix bugs, or work on your code\\n'); process.stdin.resume(); }
 else setTimeout(() => process.exit(0), 100);
}
`
  );
  fs.chmodSync(binary, 0o755);
  return binary;
}

describe('native workspace preflight', () => {
  let previousHome: string | undefined;
  beforeEach(() => {
    previousHome = process.env.HOME;
    process.env.HOME = path.join(caseDirectory, 'native-home');
    fs.mkdirSync(process.env.HOME);
  });
  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it('verifies native discovery and rejects foreign global MCP without invoking any service', () => {
    provisionAgent();
    const executable = fakeDevin();
    const profile: Profile = { executable };
    expect(
      verifyNativeWorkspace(
        profile,
        resolveSessionWorkspace('test.worker', root),
        executable,
        buildEnv(profile, undefined, true)
      )
    ).toMatchObject({
      mcpServers: [],
      skills: ['worker-guide'],
      instructionsVerified: true,
    });
    fs.mkdirSync(path.join(process.env.HOME!, '.config/devin'), { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HOME!, '.config/devin/mcp_config.json'),
      '{"mcpServers":{"foreign-project":{"command":"/bin/false"}}}'
    );
    expect(() =>
      verifyNativeWorkspace(
        profile,
        resolveSessionWorkspace('test.worker', root),
        executable,
        buildEnv(profile, undefined, true)
      )
    ).toThrow('zero MCP');
    expect(fs.existsSync(path.join(testEnv.testDir, 'launch.json'))).toBe(false);
  });

  it('does not surface secret-bearing native failure output', () => {
    provisionAgent();
    const executable = fakeDevin();
    fs.writeFileSync(
      executable,
      '#!/usr/bin/env node\nprocess.stderr.write("dummy-native-secret"); process.exit(1);\n'
    );
    const profile: Profile = { executable };
    try {
      verifyNativeWorkspace(
        profile,
        resolveSessionWorkspace('test.worker', root),
        executable,
        buildEnv(profile, undefined, true)
      );
      throw new Error('Preflight unexpectedly passed');
    } catch (error) {
      expect((error as Error).message).toContain('Workspace preflight failed');
      expect((error as Error).message).not.toContain('dummy-native-secret');
    }
  });

  it('starts the actual child in its agent workspace with sanitized env and native resume args', async () => {
    provisionAgent();
    const executable = fakeDevin();
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', workspaceRoot: root },
        profiles: {
          managed: {
            executable,
            cwd: path.join(root, 'test/agents/worker'),
          },
        },
      })
    );
    const previousToken = process.env.BB_MCP_TOKEN;
    process.env.BB_MCP_TOKEN = 'dummy-parent-credential';
    try {
      const result = await runCommand('managed', ['--resume', 'disposable-native-session'], {
        usePty: true,
        detached: true,
        sessionKey: 'workspace_test',
        workspace: 'test.worker',
      });
      expect(result).toBe(0);
      const launch = JSON.parse(
        fs.readFileSync(path.join(testEnv.testDir, 'launch.json'), 'utf8')
      ) as { cwd: string; args: string[]; envKeys: string[] };
      expect(launch.cwd).toBe(path.join(root, 'test/agents/worker'));
      expect(launch.args).toEqual(['--resume', 'disposable-native-session']);
      expect(launch.envKeys).not.toContain('BB_MCP_TOKEN');
    } finally {
      if (previousToken === undefined) delete process.env.BB_MCP_TOKEN;
      else process.env.BB_MCP_TOKEN = previousToken;
    }
  });

  it('revalidates the same agent workspace and native resume arguments across hibernate/wake generations', async () => {
    provisionAgent();
    const executable = fakeDevin(true);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: '1s', workspaceRoot: root },
        profiles: {
          managed: {
            executable,
            cwd: path.join(root, 'test/agents/worker'),
          },
        },
      })
    );
    let endpoint = '';
    const runtime = runCommand('managed', ['--resume', 'disposable-native-session'], {
      usePty: true,
      detached: true,
      sessionKey: 'workspace_wake_test',
      workspace: 'test.worker',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });
    let finished = false;
    void runtime.catch(() => undefined);
    try {
      const deadline = performance.now() + 10000;
      let hibernated = false;
      while (performance.now() < deadline) {
        if (
          endpoint &&
          (await fetchControllerInfo(endpoint)).runtime?.runtimeState === 'hibernated'
        ) {
          hibernated = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(hibernated).toBe(true);
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(endpoint);
        socket.once('error', reject);
        socket.once('connect', () =>
          socket.end(
            JSON.stringify({
              id: 'workspace-wake',
              method: 'session.input.raw',
              params: { data: ' ' },
            }) + '\n',
            () => resolve()
          )
        );
      });
      await expect(runtime).resolves.toBe(0);
      finished = true;
      const launches = fs
        .readFileSync(path.join(caseDirectory, 'launches.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(launches).toHaveLength(2);
      for (const launch of launches) {
        expect(launch.cwd).toBe(path.join(root, 'test/agents/worker'));
        expect(launch.args).toEqual(['--resume', 'disposable-native-session']);
      }
    } finally {
      if (!finished && endpoint)
        await sendControllerRequest(endpoint, {
          id: 'stop-workspace-fixture',
          method: 'session.stop',
        }).catch(() => undefined);
      await runtime.catch(() => undefined);
    }
  }, 15000);
});
