import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { buildEnv } from '../src/runtime/env';
import { buildProfileEnv, runCommand } from '../src/commands/run';
import { workspaceCommand } from '../src/commands/workspace';
import { Profile } from '../src/config/schema';
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
  instructions = path.join(caseDirectory, 'role-instructions.md');
  skillsDir = path.join(caseDirectory, 'role-skills');
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

function provisionRole() {
  return provisionWorkspace({ project: 'test', role: 'worker', root, instructions, skillsDir });
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

describe('project/role workspaces', () => {
  it('backs up and restores configuration permissions, hashes, and symlinks without exposing values', () => {
    const file = mcpFile('backup-fixture', 'dummy-backup-credential');
    const link = path.join(caseDirectory, 'linked-config');
    fs.symlinkSync(file, link);
    const destination = path.join(caseDirectory, 'backup');
    const before = fs.readFileSync(file);
    const manifest = backupWorkspaceConfiguration([file, link], destination);
    expect(fs.statSync(destination).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(manifest, 'utf8')).not.toContain('dummy-backup-credential');
    fs.writeFileSync(file, '{}');
    fs.unlinkSync(link);
    restoreWorkspaceConfiguration(destination);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readlinkSync(link)).toBe(file);
  });
  it('creates a role-only layout, is idempotent, and does not copy source repositories', () => {
    const result = provisionRole();
    expect(result.directory).toBe(path.join(root, 'test/worker'));
    expect(fs.existsSync(path.join(root, 'test/instances'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/sessions'))).toBe(false);
    const before = fs.statSync(path.join(result.directory, 'AGENTS.md')).mtimeMs;
    expect(provisionRole().changed).toEqual([]);
    expect(fs.statSync(path.join(result.directory, 'AGENTS.md')).mtimeMs).toBe(before);
    expect(
      verifyWorkspaceFiles({ project: 'test', role: 'worker' }, root).manifest.allowedMcpServers
    ).toEqual([]);
  });

  it('performs a dry run without writing workspace files or Airelay configuration', () => {
    const config = fs.readFileSync(testEnv.configPath);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(
        workspaceCommand('provision', ['test', 'worker'], {
          instructions,
          'skills-dir': skillsDir,
          'dry-run': true,
        })
      ).toBe(0);
      expect(fs.existsSync(root)).toBe(false);
      expect(fs.readFileSync(testEnv.configPath)).toEqual(config);
    } finally {
      log.mockRestore();
    }
  });

  it('rejects misspelled or valued dry-run flags before writing', () => {
    expect(() =>
      workspaceCommand('provision', ['test', 'worker'], { instructions, dryrun: true })
    ).toThrow('Unknown workspace option');
    expect(() =>
      workspaceCommand('provision', ['test', 'worker'], { instructions, 'dry-run': 'true' })
    ).toThrow('does not take a value');
    expect(fs.existsSync(root)).toBe(false);
  });

  it('bounds directory traversal before materializing an oversized Skill tree', () => {
    const directory = path.join(skillsDir, 'oversized');
    fs.mkdirSync(directory);
    for (let index = 0; index < 257; index += 1)
      fs.writeFileSync(path.join(directory, `file-${index}`), 'x');
    expect(() => provisionRole()).toThrow('entry limit');
    expect(fs.existsSync(root)).toBe(false);
  });

  it('updates only managed, unchanged assets after explicit update approval', () => {
    const role = provisionRole();
    fs.writeFileSync(instructions, '# Updated worker\n');
    expect(() => provisionRole()).toThrow('--update');
    provisionWorkspace({
      project: 'test',
      role: 'worker',
      root,
      instructions,
      skillsDir,
      update: true,
    });
    expect(fs.readFileSync(path.join(role.directory, 'AGENTS.md'), 'utf8')).toBe(
      '# Updated worker\n'
    );
    fs.writeFileSync(path.join(role.directory, 'AGENTS.md'), 'USER EDIT');
    expect(() =>
      provisionWorkspace({
        project: 'test',
        role: 'worker',
        root,
        instructions,
        skillsDir,
        update: true,
      })
    ).toThrow('asset changed');
    expect(fs.readFileSync(path.join(role.directory, 'AGENTS.md'), 'utf8')).toBe('USER EDIT');
  });

  it('refuses unmanaged contents, path traversal, and symlinked destinations', () => {
    expect(() => workspacePath({ project: '../foreign', role: 'lead' }, root)).toThrow();
    fs.mkdirSync(path.join(root, 'test/worker'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test/worker/AGENTS.md'), 'EXISTING USER CONTENT');
    expect(() => provisionRole()).toThrow('unmanaged');
    const foreign = path.join(testEnv.testDir, 'foreign');
    fs.mkdirSync(foreign);
    fs.symlinkSync(foreign, path.join(root, 'escape'));
    expect(() =>
      provisionWorkspace({ project: 'escape', role: 'lead', root, instructions })
    ).toThrow('symlink');
    expect(fs.readdirSync(foreign)).toEqual([]);
  });

  it('refuses a nested unmanaged Skill symlink before creating anything outside the workspace', () => {
    const role = provisionRole();
    const foreign = path.join(caseDirectory, 'foreign-skill-directory');
    fs.mkdirSync(foreign);
    fs.symlinkSync(foreign, path.join(role.directory, '.devin/skills/new-guide'));
    fs.mkdirSync(path.join(skillsDir, 'new-guide'));
    fs.writeFileSync(path.join(skillsDir, 'new-guide/SKILL.md'), 'New approved source asset');
    expect(() =>
      provisionWorkspace({
        project: 'test',
        role: 'worker',
        root,
        instructions,
        skillsDir,
        update: true,
      })
    ).toThrow('symlink');
    expect(fs.readdirSync(foreign)).toEqual([]);
  });

  it('shares canonical role assets while keeping worker credentials in distinct regular files', () => {
    const role = provisionRole();
    const workers = ['worker-01', 'worker-02'].map((instance, index) =>
      provisionWorkspace({
        project: 'test',
        role: 'worker',
        instance,
        root,
        principalRef: instance,
        mcpConfig: mcpFile(instance, `dummy-${index}`),
      })
    );
    for (const worker of workers) {
      expect(fs.realpathSync(path.join(worker.directory, 'AGENTS.md'))).toBe(
        path.join(role.directory, 'AGENTS.md')
      );
      expect(
        fs.realpathSync(path.join(worker.directory, '.devin/skills/worker-guide/SKILL.md'))
      ).toBe(path.join(role.directory, '.devin/skills/worker-guide/SKILL.md'));
      expect(
        fs.lstatSync(path.join(worker.directory, '.devin/mcp_config.local.json')).isSymbolicLink()
      ).toBe(false);
      expect(
        fs.statSync(path.join(worker.directory, '.devin/mcp_config.local.json')).mode & 0o777
      ).toBe(0o600);
      expect(
        fs.readFileSync(path.join(worker.directory, '.airelay-workspace.json'), 'utf8')
      ).not.toContain('dummy-');
    }
    expect(
      fs.readFileSync(path.join(workers[0].directory, '.devin/mcp_config.local.json'))
    ).not.toEqual(fs.readFileSync(path.join(workers[1].directory, '.devin/mcp_config.local.json')));
    verifyWorkspaceFiles({ project: 'test', role: 'worker', instance: 'worker-01' }, root);
  });

  it('rejects added configuration imports and unapproved Skill files', () => {
    const role = provisionRole();
    fs.writeFileSync(path.join(role.directory, '.devin/config.json'), '{}');
    expect(() => verifyWorkspaceFiles({ project: 'test', role: 'worker' }, root)).toThrow(
      'Unmanaged configuration'
    );
    fs.unlinkSync(path.join(role.directory, '.devin/config.json'));
    fs.writeFileSync(path.join(role.directory, '.devin/skills/worker-guide/foreign.md'), 'FOREIGN');
    expect(() => verifyWorkspaceFiles({ project: 'test', role: 'worker' }, root)).toThrow(
      'Unmanaged file'
    );
  });

  it('rejects credential symlinks even when a manifest has been rewritten to accept one', () => {
    const role = provisionRole();
    const credential = path.join(role.directory, '.devin/mcp_config.local.json');
    const manifestPath = path.join(role.directory, '.airelay-workspace.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.unlinkSync(credential);
    fs.symlinkSync('../AGENTS.md', credential);
    manifest.files['.devin/mcp_config.local.json'].link = '../AGENTS.md';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyWorkspaceFiles({ project: 'test', role: 'worker' }, root)).toThrow(
      'credential files'
    );
  });

  it('rolls back a failed update without changing the last verified role', () => {
    const role = provisionRole();
    const before = fs.readFileSync(path.join(role.directory, 'AGENTS.md'));
    fs.writeFileSync(instructions, '# New instructions\n');
    const rename = fs.renameSync;
    let failed = false;
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!failed && String(destination).endsWith('.airelay-workspace.json')) {
        failed = true;
        throw new Error('simulated write failure');
      }
      rename(source, destination);
    });
    try {
      expect(() =>
        provisionWorkspace({
          project: 'test',
          role: 'worker',
          root,
          instructions,
          skillsDir,
          update: true,
        })
      ).toThrow('simulated');
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(path.join(role.directory, 'AGENTS.md'))).toEqual(before);
    verifyWorkspaceFiles({ project: 'test', role: 'worker' }, root);
  });
});

describe('managed environment and launch binding', () => {
  it('limits account switching to profiles with the same managed workspace binding', () => {
    const workspace = { project: 'test', role: 'worker' };
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        profiles: {
          managed: { executable: 'devin', workspace },
          same: { executable: 'devin', workspace },
          foreign: { executable: 'devin', workspace: { project: 'other', role: 'worker' } },
          unmanaged: { executable: 'devin' },
        },
      })
    );
    expect(getSameHarnessProfiles('managed')).toEqual(['same']);
    expect(getSameHarnessProfiles('unmanaged')).toEqual([]);
  });
  it('filters foreign credentials only for managed profiles and preserves native login paths', () => {
    const original = process.env.BB_MCP_TOKEN;
    process.env.BB_MCP_TOKEN = 'dummy-foreign';
    try {
      expect(buildEnv({ executable: 'node' }).BB_MCP_TOKEN).toBe('dummy-foreign');
      const managed = buildEnv({
        executable: 'devin',
        workspace: { project: 'test', role: 'worker' },
      });
      expect(managed.BB_MCP_TOKEN).toBeUndefined();
      expect(managed.AIRELAY_SESSION_KEY).toBeUndefined();
      expect(managed.HOME).toBe(process.env.HOME);
      expect(managed.PATH).toBe(process.env.PATH);
      expect(() =>
        buildEnv({
          executable: 'devin',
          workspace: { project: 'test', role: 'worker' },
          env: { BB_MCP_TOKEN: 'dummy' },
        })
      ).toThrow('not supported');
    } finally {
      if (original === undefined) delete process.env.BB_MCP_TOKEN;
      else process.env.BB_MCP_TOKEN = original;
    }
  });

  it('registers a normal profile and preserves cwd on resume while rejecting a foreign cwd', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      workspaceCommand('provision', ['test', 'worker'], { instructions, 'skills-dir': skillsDir });
    } finally {
      log.mockRestore();
    }
    const expected = path.join(root, 'test/worker');
    expect(
      buildProfileEnv('workspace-test-worker', ['--resume', 'native-session'], expected).cwd
    ).toBe(expected);
    expect(() => buildProfileEnv('workspace-test-worker', [], testEnv.testDir)).toThrow(
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
    provisionRole();
    const executable = fakeDevin();
    const profile: Profile = { executable, workspace: { project: 'test', role: 'worker' } };
    expect(verifyNativeWorkspace(profile, root, executable, buildEnv(profile))).toMatchObject({
      mcpServers: [],
      skills: ['worker-guide'],
      instructionsVerified: true,
    });
    fs.mkdirSync(path.join(process.env.HOME!, '.config/devin'), { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HOME!, '.config/devin/mcp_config.json'),
      '{"mcpServers":{"foreign-project":{"command":"/bin/false"}}}'
    );
    expect(() => verifyNativeWorkspace(profile, root, executable, buildEnv(profile))).toThrow(
      'MCP inventory differs'
    );
    expect(fs.existsSync(path.join(testEnv.testDir, 'launch.json'))).toBe(false);
  });

  it('does not surface secret-bearing native failure output', () => {
    provisionRole();
    const executable = fakeDevin();
    fs.writeFileSync(
      executable,
      '#!/usr/bin/env node\nprocess.stderr.write("dummy-native-secret"); process.exit(1);\n'
    );
    const profile: Profile = { executable, workspace: { project: 'test', role: 'worker' } };
    try {
      verifyNativeWorkspace(profile, root, executable, buildEnv(profile));
      throw new Error('Preflight unexpectedly passed');
    } catch (error) {
      expect((error as Error).message).toContain('Workspace preflight failed');
      expect((error as Error).message).not.toContain('dummy-native-secret');
    }
  });

  it('starts the actual child in its role workspace with sanitized env and native resume args', async () => {
    provisionRole();
    const executable = fakeDevin();
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: 'off', workspaceRoot: root },
        profiles: {
          managed: {
            executable,
            cwd: path.join(root, 'test/worker'),
            workspace: { project: 'test', role: 'worker' },
          },
        },
      })
    );
    const result = await runCommand('managed', ['--resume', 'disposable-native-session'], {
      usePty: true,
      detached: true,
      sessionKey: 'workspace_test',
    });
    expect(result).toBe(0);
    const launch = JSON.parse(
      fs.readFileSync(path.join(testEnv.testDir, 'launch.json'), 'utf8')
    ) as { cwd: string; args: string[]; envKeys: string[] };
    expect(launch.cwd).toBe(path.join(root, 'test/worker'));
    expect(launch.args).toEqual(['--resume', 'disposable-native-session']);
    expect(launch.envKeys).not.toContain('BB_MCP_TOKEN');
  });

  it('revalidates the same role workspace and native resume arguments across hibernate/wake generations', async () => {
    provisionRole();
    const executable = fakeDevin(true);
    fs.writeFileSync(
      testEnv.configPath,
      JSON.stringify({
        version: 1,
        settings: { hibernateAfter: '1s', workspaceRoot: root },
        profiles: {
          managed: {
            executable,
            cwd: path.join(root, 'test/worker'),
            workspace: { project: 'test', role: 'worker' },
          },
        },
      })
    );
    let endpoint = '';
    const runtime = runCommand('managed', ['--resume', 'disposable-native-session'], {
      usePty: true,
      detached: true,
      sessionKey: 'workspace_wake_test',
      onSessionStart: (info) => {
        endpoint = info.controllerEndpoint;
      },
    });
    let finished = false;
    void runtime.catch(() => undefined);
    try {
      const deadline = Date.now() + 10000;
      let hibernated = false;
      while (Date.now() < deadline) {
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
        expect(launch.cwd).toBe(path.join(root, 'test/worker'));
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
