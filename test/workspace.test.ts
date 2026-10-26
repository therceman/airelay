import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { buildEnv } from '../src/runtime/env';
import { buildProfileEnv, runCommand } from '../src/commands/run';
import { workspaceCommand } from '../src/commands/workspace';
import { Profile } from '../src/config/schema';
import { listWorkspaces, resolveSessionWorkspace } from '../src/workspace/binding';
import { provisionWorkspace, readWorkspace, workspacePath } from '../src/workspace/provision';
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
    // Native assets are authored by the fixture, not by Airelay.
    fs.mkdirSync(path.join(result.directory, '.devin'), { recursive: true });
    for (const name of ['mcp_config.json', 'mcp_config.local.json'])
      fs.writeFileSync(path.join(result.directory, '.devin', name), '{"mcpServers":{}}', {
        mode: 0o600,
      });
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
    expect(fs.existsSync(path.join(created.directory, '.devin'))).toBe(false);
    const before = fs.statSync(path.join(created.directory, 'AGENTS.md')).mtimeMs;
    expect(provisionWorkspace(options).changed).toEqual([]);
    expect(fs.statSync(path.join(created.directory, 'AGENTS.md')).mtimeMs).toBe(before);
    expect(readWorkspace({ project: 'test', agent: 'worker' }, root).manifest).toEqual({
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
    expect(() => readWorkspace({ project: 'test', agent: 'worker' }, root)).not.toThrow();
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
  it('leaves user-owned links opaque, including external, broken and cyclic links', () => {
    const agent = provisionAgent();
    const other = provisionWorkspace({ project: 'test', agent: 'other', root });
    const file = path.join(other.directory, 'AGENTS.md');
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(agent.directory, 'AGENTS.md'), file);
    expect(() => readWorkspace({ project: 'test', agent: 'other' }, root)).not.toThrow();
    fs.unlinkSync(file);
    fs.symlinkSync(instructions, file);
    expect(() => resolveSessionWorkspace('test.other', root)).not.toThrow();
    const skills = path.join(other.directory, '.devin/skills');
    fs.mkdirSync(skills, { recursive: true });
    fs.symlinkSync(skills, path.join(skills, 'cycle'));
    fs.symlinkSync(path.join(caseDirectory, 'missing'), path.join(skills, 'broken'));
    expect(() => resolveSessionWorkspace('test.other', root)).not.toThrow();
    expect(provisionWorkspace({ project: 'test', agent: 'other', root }).changed).toEqual([]);
    expect(listWorkspaces(root).map((w) => w.selector)).toEqual(['test.other', 'test.worker']);
    expect(fs.readlinkSync(file)).toBe(instructions);
    expect(fs.readlinkSync(path.join(skills, 'cycle'))).toBe(skills);
  });
  it('treats native MCP and import configuration as opaque user-owned files', () => {
    const agent = provisionAgent();
    const local = path.join(agent.directory, '.devin/mcp_config.local.json');
    const configured = '{"mcpServers":{"project-tool":{"command":"/bin/false"}}}';
    fs.writeFileSync(local, configured);
    fs.chmodSync(local, 0o600);
    fs.writeFileSync(path.join(agent.directory, '.devin/config.json'), '{"imports":[]}');
    expect(() => readWorkspace({ project: 'test', agent: 'worker' }, root)).not.toThrow();
    expect(provisionWorkspace({ project: 'test', agent: 'worker', root }).changed).toEqual([]);
    expect(fs.readFileSync(local, 'utf8')).toBe(configured);
    expect(fs.statSync(local).mode & 0o777).toBe(0o600);
  });
  it.each(['file size', 'total size', 'directory entries', 'tree size', 'tree depth'])(
    'does not impose a %s quota on user content across verification, discovery and launch',
    (kind) => {
      const agent = provisionAgent();
      const skills = path.join(agent.directory, '.devin/skills');
      if (kind === 'file size')
        fs.writeFileSync(path.join(skills, 'large'), Buffer.alloc(5 * 1024 * 1024));
      if (kind === 'total size') {
        for (let i = 0; i < 3; i++)
          fs.writeFileSync(path.join(skills, `large-${i}`), Buffer.alloc(2 * 1024 * 1024));
      }
      if (kind === 'directory entries') {
        for (let i = 0; i < 257; i++) fs.writeFileSync(path.join(skills, `extra-${i}`), 'x');
      }
      if (kind === 'tree size') {
        for (let i = 0; i < 6; i++) {
          const directory = path.join(skills, `group-${i}`);
          fs.mkdirSync(directory);
          for (let j = 0; j < 200; j++) fs.writeFileSync(path.join(directory, `entry-${j}`), 'x');
        }
      }
      if (kind === 'tree depth')
        fs.mkdirSync(path.join(skills, ...Array<string>(12).fill('nested')), { recursive: true });
      const manifest = path.join(agent.directory, '.airelay-workspace.json');
      const before = fs.readFileSync(manifest);
      const reads = jest.spyOn(fs, 'readFileSync');
      const scans = jest.spyOn(fs, 'opendirSync');
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        expect(readWorkspace({ project: 'test', agent: 'worker' }, root).directory).toBe(
          agent.directory
        );
        expect(provisionWorkspace({ project: 'test', agent: 'worker', root }).changed).toEqual([]);
        const workspace = resolveSessionWorkspace('test.worker', root);
        expect(listWorkspaces(root)).toEqual([workspace]);
        expect(workspaceCommand('verify', ['test.worker'], { json: true })).toBe(0);
        expect(buildProfileEnv('existing', [], undefined, undefined, false, workspace).cwd).toBe(
          agent.directory
        );
        // Binding checks may read only Airelay metadata/config, never the agent's files.
        expect(
          reads.mock.calls.filter(([file]) => String(file).startsWith(agent.directory))
        ).not.toEqual([]);
        expect(
          reads.mock.calls
            .filter(([file]) => String(file).startsWith(agent.directory))
            .every(([file]) => file === manifest)
        ).toBe(true);
        expect(scans.mock.calls.map(([directory]) => directory)).not.toContain(agent.directory);
        expect(scans.mock.calls).toHaveLength(3);
      } finally {
        reads.mockRestore();
        scans.mockRestore();
        log.mockRestore();
      }
      expect(fs.readFileSync(manifest)).toEqual(before);
    }
  );
  it('does not inspect live Unix sockets inside a Workspace', async () => {
    const agent = provisionAgent();
    const server = net.createServer();
    // Keep the Unix socket path short on hosts with a long temporary root.
    const socket = path.join(agent.directory, 'agent.sock');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    try {
      expect(() => resolveSessionWorkspace('test.worker', root)).not.toThrow();
      expect(provisionWorkspace({ project: 'test', agent: 'worker', root }).changed).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('bounds only the Airelay manifest read and rejects a symlinked manifest', () => {
    const agent = provisionAgent();
    const file = path.join(agent.directory, '.airelay-workspace.json');
    fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(() => resolveSessionWorkspace('test.worker', root)).toThrow('unsupported');
    fs.unlinkSync(file);
    fs.symlinkSync(instructions, file);
    expect(() => resolveSessionWorkspace('test.worker', root)).toThrow('symlink');
  });
  it('fails closed on obsolete manifests and mismatched Agent identity', () => {
    const agent = provisionAgent();
    const file = path.join(agent.directory, '.airelay-workspace.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, binding: { project: 'test', role: 'worker' } })
    );
    expect(() => readWorkspace({ project: 'test', agent: 'worker' }, root)).toThrow('unsupported');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 2, binding: { project: 'test', agent: 'other' } })
    );
    expect(() => readWorkspace({ project: 'test', agent: 'worker' }, root)).toThrow(
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
  it('does not parse native configuration or require an instructions file', () => {
    const agent = provisionAgent();
    const file = path.join(agent.directory, '.devin/mcp_config.local.json');
    const nativeConfig = '{"token":"dummy-private-secret", invalid';
    fs.writeFileSync(file, nativeConfig);
    fs.unlinkSync(path.join(agent.directory, 'AGENTS.md'));
    expect(() => readWorkspace({ project: 'test', agent: 'worker' }, root)).not.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(nativeConfig);
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
  it('uses normal profile environment semantics instead of a Workspace allowlist', () => {
    const previous = process.env.WORKSPACE_APP_TOKEN;
    process.env.WORKSPACE_APP_TOKEN = 'dummy-parent';
    try {
      const profile: Profile = {
        executable: 'node',
        env: { WORKSPACE_APP_TOKEN: 'dummy-profile', HOME: '~/app' },
      };
      expect(buildEnv({ executable: 'node' }).WORKSPACE_APP_TOKEN).toBe('dummy-parent');
      expect(buildEnv(profile).WORKSPACE_APP_TOKEN).toBe('dummy-profile');
      expect(buildEnv(profile).HOME).not.toContain('~');
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_APP_TOKEN;
      else process.env.WORKSPACE_APP_TOKEN = previous;
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
    expect(
      buildProfileEnv(
        'devin',
        ['--config', '/native/config.json'],
        undefined,
        undefined,
        false,
        binding
      ).args
    ).toEqual(['--config', '/native/config.json']);
  });
});

function fakeDevin(hibernateOnce = false): string {
  const binary = path.join(testEnv.testDir, hibernateOnce ? 'devin' : 'custom-agent');
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const cwd = process.cwd();
if (['mcp', 'skills', 'rules'].includes(args[0])) process.exit(99);
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

describe('generic Workspace launch', () => {
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

  it('verifies the filesystem without invoking or inspecting the harness', () => {
    provisionAgent();
    const profile = {
      executable: '/not-installed/custom-agent',
      args: ['--native-config', 'custom.json'],
    };
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { workspaceRoot: root },
        profiles: { custom: profile },
      })
    );
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(workspaceCommand('verify', ['test.worker'], { profile: 'custom', json: true })).toBe(
        0
      );
      const result = JSON.parse(log.mock.calls[0][0]);
      expect(result.verification).toBe('filesystem');
      expect(result.profile).toBe('custom');
      expect(result).not.toHaveProperty('instructionsVerified');
      expect(workspaceCommand('verify', ['test.worker'], { json: true })).toBe(0);
      expect(JSON.parse(log.mock.calls[1][0])).not.toHaveProperty('profile');
      expect(() => workspaceCommand('verify', ['test.worker'], { profile: 'missing' })).toThrow(
        'Profile not found'
      );
      expect(() => workspaceCommand('verify', ['test.worker'], { profile: '' })).toThrow(
        'Profile not found'
      );
    } finally {
      log.mockRestore();
    }
    expect(fs.existsSync(path.join(testEnv.testDir, 'launch.json'))).toBe(false);
  });

  it('starts the actual child with configured MCP, its workspace cwd, normal profile env and native resume args', async () => {
    const agent = provisionAgent();
    fs.writeFileSync(path.join(agent.directory, 'large-user-data'), Buffer.alloc(5 * 1024 * 1024));
    fs.writeFileSync(
      path.join(agent.directory, '.devin/mcp_config.local.json'),
      '{"mcpServers":{"project-tool":{"command":"/bin/false"}}}'
    );
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
      expect(launch.envKeys).toContain('BB_MCP_TOKEN');
    } finally {
      if (previousToken === undefined) delete process.env.BB_MCP_TOKEN;
      else process.env.BB_MCP_TOKEN = previousToken;
    }
  });

  it('wakes the same agent workspace after user content grows beyond the former quota', async () => {
    const agent = provisionAgent();
    const local = path.join(agent.directory, '.devin/mcp_config.local.json');
    const configured = '{"mcpServers":{"project-tool":{"command":"/bin/false"}}}';
    fs.writeFileSync(local, configured);
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
      const userData = path.join(agent.directory, 'large-user-data');
      fs.writeFileSync(userData, Buffer.alloc(5 * 1024 * 1024));
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
      expect(fs.statSync(userData).size).toBe(5 * 1024 * 1024);
      expect(fs.readFileSync(local, 'utf8')).toBe(configured);
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
