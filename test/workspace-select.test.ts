import fs from 'node:fs';
import path from 'node:path';
import Enquirer from 'enquirer';
import { execFileSync } from 'node:child_process';
import { createPty } from '../src/runtime/pty';
import { chooseSessionWorkspace } from '../src/commands/workspace-select';
import { provisionWorkspace } from '../src/workspace/provision';
import { loadConfig } from '../src/config/load';
import { configSetCommand } from '../src/commands/config';
import { WorkspaceProjectsSchema } from '../src/config/schema';
import {
  createLauncherWorkspace,
  findWorkspaceProject,
  sourceDirectory,
} from '../src/workspace/projects';
import { resolveSessionWorkspace } from '../src/workspace/binding';
import { useTestEnv } from './test-utils';

jest.mock('enquirer', () => ({ prompt: jest.fn() }));
const env = useTestEnv();
let root: string;
let source: string;
let log: jest.SpyInstance;
const prompt = Enquirer.prompt as jest.Mock;
const answer = (...answers: object[]) =>
  answers.forEach((value) => prompt.mockResolvedValueOnce(value));
const menu = (index: number) =>
  prompt.mock.calls[index][0] as {
    message: string;
    choices: Array<{ name: string; message: string }>;
    initial: string;
  };
const names = (index: number) => menu(index).choices.map((choice) => choice.name);
function role(selector: string) {
  const instructions = path.join(env.testDir, 'launcher-instructions.md');
  fs.writeFileSync(instructions, '# Role\n');
  const parts = selector.split('.');
  provisionWorkspace({
    project: parts[0],
    role: parts[parts.length - 1],
    selector,
    root,
    instructions,
  });
}
function associate(directory = source, project = 'rsg', storageRoot = root) {
  configSetCommand(
    'settings.workspaceProjects',
    JSON.stringify([{ source: directory, root: storageRoot, project }])
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  root = path.join(env.testDir, 'launcher-root');
  source = path.join(env.testDir, 'agentvm');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    env.configPath,
    JSON.stringify({
      version: 1,
      settings: { workspaceRoot: root },
      profiles: { devin: { executable: 'devin' } },
    })
  );
});
afterEach(() => log.mockRestore());

it('shows projects first, then immediate children, without flat leaf choices or Profile changes', async () => {
  role('rsg.lead');
  role('bb_splunk.roles.worker');
  role('bb_splunk.agents.worker1');
  const before = fs.readFileSync(env.configPath);
  answer(
    { workspace: 'node:bb_splunk' },
    { workspace: 'node:bb_splunk.roles' },
    { workspace: 'node:bb_splunk.roles.worker' },
    { remember: false }
  );
  expect(await chooseSessionWorkspace(source)).toEqual(
    resolveSessionWorkspace('bb_splunk.roles.worker', root)
  );
  expect(names(0)).toEqual(['node:bb_splunk', 'node:rsg', 'create', 'none']);
  expect(names(1)).toEqual([
    'node:bb_splunk.agents',
    'node:bb_splunk.roles',
    'create',
    'back',
    'none',
  ]);
  expect(names(2)).toContain('node:bb_splunk.roles.worker');
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('navigates Back through intermediate directories and all projects', async () => {
  role('bb_splunk.instances.worker-01');
  role('rsg.lead');
  answer(
    { workspace: 'node:bb_splunk' },
    { workspace: 'node:bb_splunk.instances' },
    { workspace: 'back' },
    { workspace: 'back' },
    { workspace: 'none' }
  );
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(names(1)).toEqual(names(3));
  expect(names(0)).toEqual(names(4));
});
it('does not treat reserved-looking project names as menu actions', async () => {
  role('create.lead');
  answer({ workspace: 'node:create' }, { workspace: 'node:create.lead' }, { remember: false });
  expect((await chooseSessionWorkspace(source))?.selector).toBe('create.lead');
});
it('shows the configured root as read-only information even when no Workspaces exist', async () => {
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'none' });
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(menu(0).message).toContain(root);
  expect(names(0)).toEqual(['create', 'none']);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
  expect(fs.existsSync(root)).toBe(false);
});
it('rejects the removed root-settings action without prompting or changing configuration', async () => {
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'settings' });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('not available');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('creates a new zero-MCP Role from an empty launcher without generating a profile', async () => {
  const sourceBefore = fs.readdirSync(source);
  answer(
    { workspace: 'create' },
    { selector: 'agentvm.lead' },
    { instructions: '' },
    { create: true },
    { remember: true }
  );
  const selected = await chooseSessionWorkspace(source);
  expect(selected).toEqual(resolveSessionWorkspace('agentvm.lead', root));
  expect(menu(1).initial).toBe('agentvm.lead');
  expect(fs.readFileSync(path.join(selected!.path, 'AGENTS.md'), 'utf8')).toContain(source);
  expect(fs.readdirSync(path.join(selected!.path, '.devin/skills'))).toEqual([]);
  for (const file of ['mcp_config.json', 'mcp_config.local.json']) {
    expect(JSON.parse(fs.readFileSync(path.join(selected!.path, '.devin', file), 'utf8'))).toEqual({
      mcpServers: {},
    });
  }
  expect(loadConfig().settings.workspaceProjects).toEqual([{ source, root, project: 'agentvm' }]);
  expect(loadConfig().profiles).toEqual({ devin: { executable: 'devin' } });
  expect(fs.readdirSync(source)).toEqual(sourceBefore);
});
it('can create within an existing project using an explicitly selected instructions file', async () => {
  role('rsg.worker');
  const instructions = path.join(source, 'role.md');
  fs.writeFileSync(instructions, '# Approved role\n');
  answer(
    { workspace: 'node:rsg' },
    { workspace: 'create' },
    { selector: 'rsg.lead' },
    { instructions: 'role.md' },
    { create: true },
    { remember: false }
  );
  const selected = await chooseSessionWorkspace(source);
  expect(menu(2).initial).toBe('rsg.lead');
  expect(fs.readFileSync(path.join(selected!.path, 'AGENTS.md'), 'utf8')).toBe('# Approved role\n');
  expect(fs.readFileSync(instructions, 'utf8')).toBe('# Approved role\n');
});
it('cancelled creation performs no Workspace or configuration writes', async () => {
  const before = fs.readFileSync(env.configPath);
  answer(
    { workspace: 'create' },
    { selector: 'agentvm.lead' },
    { instructions: '' },
    { create: false },
    { workspace: 'none' }
  );
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('rejects traversal, escaping links, existing directories and altered managed assets', async () => {
  const options = { selector: 'rsg.lead', root, source };
  expect(() => createLauncherWorkspace({ ...options, selector: '../outside' })).toThrow(
    'Invalid workspace selector'
  );
  fs.mkdirSync(path.join(root, 'rsg/lead'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rsg/lead/user.txt'), 'preserve');
  expect(() => createLauncherWorkspace(options)).toThrow('already exists');
  expect(fs.readFileSync(path.join(root, 'rsg/lead/user.txt'), 'utf8')).toBe('preserve');
  fs.symlinkSync(source, path.join(root, 'escape'));
  expect(() => createLauncherWorkspace({ ...options, selector: 'escape.lead' })).toThrow('symlink');
  fs.unlinkSync(path.join(root, 'escape'));
  role('rsg.worker');
  fs.appendFileSync(path.join(root, 'rsg/worker/AGENTS.md'), 'changed');
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('Workspace asset changed');
});
it('revalidates a selected Workspace after an interactive pause', async () => {
  role('rsg.lead');
  answer({ workspace: 'node:rsg' });
  prompt.mockImplementationOnce(async () => {
    fs.appendFileSync(path.join(root, 'rsg/lead/AGENTS.md'), 'changed');
    return { workspace: 'node:rsg.lead' };
  });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('Workspace asset changed');
});
it('rejects an unavailable choice instead of silently selecting another Workspace', async () => {
  role('rsg.lead');
  answer({ workspace: 'node:rsg.lead' });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('not available');
});
it('saves a confirmed folder association and opens only its project branch on later starts', async () => {
  role('rsg.lead');
  answer({ workspace: 'node:rsg' }, { workspace: 'node:rsg.lead' }, { remember: true });
  await chooseSessionWorkspace(source);
  prompt.mockClear();
  answer({ workspace: 'none' });
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(menu(0).message).toContain('Select within rsg');
  expect(names(0)).toContain('node:rsg.lead');
  expect(prompt).toHaveBeenCalledTimes(1);
});
it('detects an explicitly associated project from a child source directory', async () => {
  role('rsg.lead');
  associate();
  const child = path.join(source, 'src');
  fs.mkdirSync(child, { recursive: true });
  answer({ workspace: 'node:rsg.lead' });
  expect((await chooseSessionWorkspace(child))?.selector).toBe('rsg.lead');
  expect(menu(0).message).toContain('Select within rsg');
  expect(prompt).toHaveBeenCalledTimes(1);
});
it('ignores stale projects and associations for a different storage root', async () => {
  role('bb_splunk.lead');
  associate();
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(source);
  expect(menu(0).message).toContain('Select a Workspace project');
  associate(source, 'bb_splunk', path.join(env.testDir, 'old-root'));
  prompt.mockClear();
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(source);
  expect(menu(0).message).toContain('Select a Workspace project');
});
it('allows leaving the detected branch and explicitly replacing a source association', async () => {
  role('rsg.lead');
  role('bb_splunk.worker');
  associate();
  answer(
    { workspace: 'back' },
    { workspace: 'node:bb_splunk' },
    { workspace: 'node:bb_splunk.worker' },
    { remember: true }
  );
  expect((await chooseSessionWorkspace(source))?.selector).toBe('bb_splunk.worker');
  expect(loadConfig().settings.workspaceProjects).toEqual([{ source, root, project: 'bb_splunk' }]);
});
it('resolves a symlinked invocation directory to its real project source', async () => {
  const alias = path.join(env.testDir, 'source-alias');
  fs.symlinkSync(source, alias);
  role('rsg.lead');
  associate();
  expect(sourceDirectory(alias)).toBe(source);
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(alias);
  expect(menu(0).message).toContain('Select within rsg');
});
it('chooses the longest explicit ancestor without matching sibling path prefixes', () => {
  const links = [
    { source, root, project: 'rsg' },
    { source: path.join(source, 'nested'), root, project: 'bb' },
  ];
  expect(findWorkspaceProject(path.join(source, 'nested/src'), root, links)?.project).toBe('bb');
  expect(findWorkspaceProject(`${source}-other`, root, links)).toBeUndefined();
});
it('bounds and validates global associations and preserves private config permissions', () => {
  const before = fs.readFileSync(env.configPath);
  expect(() =>
    configSetCommand(
      'settings.workspaceProjects',
      '[{"source":"relative","root":"/tmp","project":"rsg"}]'
    )
  ).toThrow();
  expect(fs.readFileSync(env.configPath)).toEqual(before);
  const link = { source, root, project: 'rsg' };
  expect(WorkspaceProjectsSchema.safeParse([link, link]).success).toBe(false);
  expect(
    WorkspaceProjectsSchema.safeParse(
      Array.from({ length: 129 }, (_, i) => ({ ...link, source: `${source}/${i}` }))
    ).success
  ).toBe(false);
  fs.chmodSync(env.configPath, 0o600);
  associate();
  expect(fs.statSync(env.configPath).mode & 0o777).toBe(0o600);
  configSetCommand('settings.workspaceProjects', '[]');
  expect(loadConfig().settings.workspaceProjects).toEqual([]);
});

it('browses real Enquirer project and Role menus in a disposable terminal without launching an agent', async () => {
  role('rsg.lead');
  const repository = path.join(__dirname, '..');
  execFileSync('npm', ['run', '-s', 'build'], { cwd: repository, stdio: 'pipe' });
  const script = `require(${JSON.stringify(path.join(repository, 'dist/commands/workspace-select.js'))}).chooseSessionWorkspace().then(w => {console.log('SELECTED:' + w.selector); process.exit(0)}).catch(e => {console.error(e.message); process.exit(1)});`;
  let stage = 0;
  let frame = '';
  let firstPage = '';
  let output = '';
  const terminal = createPty({
    file: process.execPath,
    args: ['-e', script],
    cwd: source,
    detached: true,
    env: { AIRELAY_CONFIG: env.configPath },
    onOutput: (chunk) => {
      output += chunk;
      frame += chunk;
      if (
        (stage === 0 || stage === 1) &&
        frame.includes(stage === 0 ? 'Select a Workspace project' : 'Select within rsg') &&
        frame.includes('Without workspace (normal profile/current directory)')
      ) {
        if (stage === 0) firstPage = frame;
        stage++;
        frame = '';
        terminal.write('\r');
      } else if (stage === 2 && frame.includes('for future launcher selections?')) {
        stage++;
        frame = '';
        terminal.write('n\r');
      }
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(
      await Promise.race([
        terminal.exitCode,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Launcher fixture did not exit')), 10000);
        }),
      ])
    ).toBe(0);
    expect(firstPage).toContain('rsg');
    expect(firstPage).not.toContain('rsg.lead');
    expect(output).not.toContain('Change workspace root...');
    expect(output).toContain('SELECTED:rsg.lead');
    expect(stage).toBe(3);
  } finally {
    clearTimeout(timeout);
    terminal.kill();
  }
}, 20000);
