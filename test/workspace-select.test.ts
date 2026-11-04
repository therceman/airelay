import fs from 'node:fs';
import path from 'node:path';
import Enquirer from 'enquirer';
import { execFileSync } from 'node:child_process';
import { createPty } from '../src/runtime/pty';
import { chooseSessionWorkspace } from '../src/commands/workspace-select';
import { provisionWorkspace } from '../src/workspace/provision';
import { loadConfig } from '../src/config/load';
import { recordLaunchHistory, markLaunchHistoryUsed } from '../src/commands/history';
import { runCommand } from '../src/commands/run';
import { createLauncherWorkspace, sourceDirectory } from '../src/workspace/projects';
import { resolveSessionWorkspace } from '../src/workspace/binding';
import { useTestEnv } from './test-utils';

jest.mock('enquirer', () => ({ prompt: jest.fn() }));
const env = useTestEnv();
let root: string;
let source: string;
let log: jest.SpyInstance;
let usageIndex = 0;
const prompt = Enquirer.prompt as jest.Mock;
const answer = (...answers: object[]) =>
  answers.forEach((value) => prompt.mockResolvedValueOnce(value));
const menu = (index: number) =>
  prompt.mock.calls[index][0] as {
    message: string;
    choices: Array<{ name: string; message: string }>;
    initial: string | boolean;
    format: (
      this: {
        state: { submitted: boolean; cancelled: boolean };
        styles: { primary: (label: string) => string };
      },
      value: string
    ) => string;
  };
const names = (index: number) => menu(index).choices.map((choice) => choice.name);
const formatted = (index: number, value: string, submitted = true, cancelled = false) =>
  menu(index).format.call(
    { state: { submitted, cancelled }, styles: { primary: (label) => label } },
    value
  );
function agentWorkspace(selector: string) {
  const parts = selector.split('.');
  provisionWorkspace({
    project: parts[0],
    agent: parts[parts.length - 1],
    root,
  });
}
function recordUsage(selector: string, startedAt: number, profile = 'devin') {
  return recordLaunchHistory({
    profile,
    sessionKey: `usage_${usageIndex++}`,
    invocationCwd: source,
    argv: ['start', profile, '--workspace', selector],
    startedAt,
    workspace: resolveSessionWorkspace(selector, root),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  root = path.join(env.testDir, 'launcher-root');
  source = path.join(env.testDir, 'agentvm');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(env.historyPath, { force: true });
  fs.rmSync(env.sessionsPath, { force: true });
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

it('shows projects first, then agents, without roles or storage-root settings', async () => {
  agentWorkspace('rsg.lead');
  agentWorkspace('bb_splunk.worker');
  agentWorkspace('bb_splunk.worker1');
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'node:bb_splunk' }, { workspace: 'node:bb_splunk.worker1' });
  expect(await chooseSessionWorkspace(source)).toEqual(
    resolveSessionWorkspace('bb_splunk.worker1', root)
  );
  expect(names(0)).toEqual(['node:bb_splunk', 'node:rsg', 'create', 'none']);
  expect(names(1)).toEqual(['node:bb_splunk.worker', 'node:bb_splunk.worker1', 'create', 'none']);
  expect(formatted(0, 'node:bb_splunk')).toBe('bb_splunk');
  expect(formatted(1, 'node:bb_splunk.worker1')).toBe('worker1');
  expect(formatted(1, 'create')).toBe('Create new Workspace...');
  expect(formatted(1, 'none')).toBe('Without workspace (normal profile/current directory)');
  expect(formatted(1, 'node:bb_splunk.worker1', false)).toBe('');
  expect(formatted(1, 'node:bb_splunk.worker1', true, true)).toBe('');
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('always shows projects even with an obsolete folder association, preserving games.lead binding', async () => {
  agentWorkspace('games.lead');
  agentWorkspace('rsg.lead');
  const raw = JSON.parse(fs.readFileSync(env.configPath, 'utf8'));
  raw.settings.workspaceProjects = [{ source, root, project: 'games' }];
  fs.writeFileSync(env.configPath, JSON.stringify(raw));
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'node:games' }, { workspace: 'node:games.lead' });
  const selected = await chooseSessionWorkspace(source);
  expect(menu(0).message).toBe(`Select a Workspace project (${root})`);
  expect(names(0)).toEqual(['node:games', 'node:rsg', 'create', 'none']);
  expect(menu(1).message).toBe(`Select an agent in games (${root})`);
  expect(menu(1).choices[0].message).toBe('lead');
  expect(formatted(1, 'node:games.lead')).toBe('lead');
  expect(selected).toEqual({
    selector: 'games.lead',
    root,
    path: path.join(root, 'games/agents/lead'),
  });
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('rejects the removed Back action without navigating or changing configuration', async () => {
  agentWorkspace('bb_splunk.worker');
  agentWorkspace('rsg.lead');
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'node:bb_splunk' }, { workspace: 'back' });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('not available');
  expect(names(0)).not.toContain('back');
  expect(names(1)).not.toContain('back');
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('does not treat reserved-looking project names as menu actions', async () => {
  agentWorkspace('create.lead');
  answer({ workspace: 'node:create' }, { workspace: 'node:create.lead' });
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
it('lists Workspaces without resolving the invocation directory', async () => {
  agentWorkspace('games.lead');
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(path.join(env.testDir, 'missing-source'));
  expect(names(0)).toEqual(['node:games', 'create', 'none']);
});
it('rejects the removed root-settings action without prompting or changing configuration', async () => {
  const before = fs.readFileSync(env.configPath);
  answer({ workspace: 'settings' });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('not available');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('creates a harness-neutral agent directory without generating native configuration or a profile', async () => {
  const sourceBefore = fs.readdirSync(source);
  answer({ workspace: 'create' }, { selector: 'agentvm.lead' }, { create: true });
  const selected = await chooseSessionWorkspace(source);
  expect(selected).toEqual(resolveSessionWorkspace('agentvm.lead', root));
  expect(menu(1).initial).toBe('agentvm.lead');
  expect(menu(2).message).toBe('Create Workspace agentvm.lead?');
  expect(menu(2).initial).toBe(false);
  expect(prompt).toHaveBeenCalledTimes(3);
  expect(log).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(selected!.path, 'AGENTS.md'), 'utf8')).toContain(source);
  expect(fs.readdirSync(selected!.path).sort()).toEqual(['.airelay-workspace.json', 'AGENTS.md']);
  expect(fs.readFileSync(env.configPath, 'utf8')).not.toContain('workspaceProjects');
  expect(loadConfig().profiles).toEqual({ devin: { executable: 'devin' } });
  expect(fs.readdirSync(source)).toEqual(sourceBefore);
});
it('creates within an existing project without asking for instructions or a role', async () => {
  agentWorkspace('rsg.worker');
  answer(
    { workspace: 'node:rsg' },
    { workspace: 'create' },
    { selector: 'rsg.lead' },
    { create: true }
  );
  const selected = await chooseSessionWorkspace(source);
  expect(menu(2).initial).toBe('rsg.lead');
  expect(menu(2).message).toBe('New Workspace selector (<project>.<agent>)');
  expect(menu(3).message).toBe('Create Workspace rsg.lead?');
  expect(fs.existsSync(path.join(selected!.path, 'AGENTS.md'))).toBe(true);
  expect(prompt.mock.calls.map((call) => call[0].name)).toEqual([
    'workspace',
    'workspace',
    'selector',
    'create',
  ]);
});
it('cancelled creation performs no Workspace or configuration writes', async () => {
  const before = fs.readFileSync(env.configPath);
  answer(
    { workspace: 'create' },
    { selector: 'agentvm.lead' },
    { create: false },
    { workspace: 'none' }
  );
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.readFileSync(env.configPath)).toEqual(before);
});
it('rejects traversal, linked Workspace paths/manifests and existing unmanaged directories', async () => {
  const options = { selector: 'rsg.lead', root, source };
  expect(() => createLauncherWorkspace({ ...options, selector: '../outside' })).toThrow(
    'Invalid workspace selector'
  );
  fs.mkdirSync(path.join(root, 'rsg/agents/lead'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rsg/agents/lead/user.txt'), 'preserve');
  expect(() => createLauncherWorkspace(options)).toThrow('already exists');
  expect(fs.readFileSync(path.join(root, 'rsg/agents/lead/user.txt'), 'utf8')).toBe('preserve');
  fs.symlinkSync(source, path.join(root, 'escape'));
  expect(() => createLauncherWorkspace({ ...options, selector: 'escape.lead' })).toThrow('symlink');
  fs.unlinkSync(path.join(root, 'escape'));
  agentWorkspace('rsg.worker');
  const asset = path.join(root, 'rsg/agents/worker/.airelay-workspace.json');
  fs.unlinkSync(asset);
  fs.symlinkSync(path.join(source, 'outside.md'), asset);
  fs.writeFileSync(path.join(source, 'outside.md'), 'outside');
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('symlink');
});
it('accepts updated instructions after an interactive pause', async () => {
  agentWorkspace('rsg.lead');
  answer({ workspace: 'node:rsg' });
  prompt.mockImplementationOnce(async () => {
    fs.appendFileSync(path.join(root, 'rsg/agents/lead/AGENTS.md'), 'changed');
    return { workspace: 'node:rsg.lead' };
  });
  expect((await chooseSessionWorkspace(source))?.selector).toBe('rsg.lead');
});
it('rejects an unavailable choice instead of silently selecting another Workspace', async () => {
  agentWorkspace('rsg.lead');
  answer({ workspace: 'node:rsg.lead' });
  await expect(chooseSessionWorkspace(source)).rejects.toThrow('not available');
});
it('sorts projects and agents by latest use across profiles, including resumed history rows', async () => {
  for (const selector of ['alpha.lead', 'games.older', 'games.recent', 'aaa.unused'])
    agentWorkspace(selector);
  recordUsage('alpha.lead', 100);
  const resumed = recordUsage('games.recent', 150, 'another-profile');
  recordUsage('games.older', 200);
  expect(markLaunchHistoryUsed(resumed.id, 300)).toBe(true);
  // An older launch of the same Workspace must not overwrite its latest use.
  recordUsage('games.recent', 50);
  answer({ workspace: 'node:games' }, { workspace: 'node:games.recent' });
  expect((await chooseSessionWorkspace(source))?.selector).toBe('games.recent');
  expect(names(0)).toEqual(['node:games', 'node:alpha', 'node:aaa', 'create', 'none']);
  expect(names(1)).toEqual(['node:games.recent', 'node:games.older', 'create', 'none']);
});
it('uses alphabetical ties and puts never-used entries after used entries, including epoch zero', async () => {
  for (const selector of ['alpha.z', 'alpha.a', 'alpha.unused', 'beta.lead', 'aaa.unused'])
    agentWorkspace(selector);
  recordUsage('alpha.z', 0);
  recordUsage('alpha.a', 0);
  recordUsage('beta.lead', 0);
  answer({ workspace: 'node:alpha' }, { workspace: 'node:alpha.a' });
  await chooseSessionWorkspace(source);
  expect(names(0)).toEqual(['node:alpha', 'node:beta', 'node:aaa', 'create', 'none']);
  expect(names(1)).toEqual(['node:alpha.a', 'node:alpha.z', 'node:alpha.unused', 'create', 'none']);
});
it('ignores history from other roots, changed paths, removed Workspaces and ordinary launches', async () => {
  agentWorkspace('alpha.lead');
  agentWorkspace('games.lead');
  recordUsage('alpha.lead', 100);
  const games = resolveSessionWorkspace('games.lead', root);
  for (const workspace of [
    { ...games, root: path.join(env.testDir, 'other-root') },
    { ...games, path: path.join(root, 'other-path') },
    { ...games, selector: 'removed.lead', path: path.join(root, 'removed/agents/lead') },
    undefined,
  ])
    recordLaunchHistory({
      profile: 'devin',
      sessionKey: `ignored_${usageIndex++}`,
      invocationCwd: source,
      argv: ['start', 'devin'],
      startedAt: 9999,
      workspace,
    });
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(source);
  expect(names(0)).toEqual(['node:alpha', 'node:games', 'create', 'none']);
});
it('shows the same project list from any source directory without recording mere selections', async () => {
  agentWorkspace('games.lead');
  agentWorkspace('alpha.lead');
  recordUsage('games.lead', 123);
  const config = fs.readFileSync(env.configPath);
  const history = fs.readFileSync(env.historyPath);
  const child = path.join(source, 'nested');
  fs.mkdirSync(child, { recursive: true });
  const alias = path.join(env.testDir, 'source-alias');
  fs.symlinkSync(child, alias);
  expect(sourceDirectory(alias)).toBe(child);
  for (const directory of [source, child, alias]) {
    prompt.mockClear();
    answer({ workspace: 'node:alpha' }, { workspace: 'node:alpha.lead' });
    expect((await chooseSessionWorkspace(directory))?.selector).toBe('alpha.lead');
    expect(names(0)).toEqual(['node:games', 'node:alpha', 'create', 'none']);
    expect(prompt).toHaveBeenCalledTimes(2);
  }
  expect(fs.readFileSync(env.configPath)).toEqual(config);
  expect(fs.readFileSync(env.historyPath)).toEqual(history);
});
it('does not rewrite duplicate historical records while showing or cancelling the menu', async () => {
  agentWorkspace('games.lead');
  recordUsage('games.lead', 123);
  const rows = JSON.parse(fs.readFileSync(env.historyPath, 'utf8'));
  rows.push({ ...rows[0], id: 'duplicate-record', startedAt: 100 });
  fs.writeFileSync(env.historyPath, JSON.stringify(rows));
  const before = fs.readFileSync(env.historyPath);
  answer({ workspace: 'none' });
  expect(await chooseSessionWorkspace(source)).toBeUndefined();
  expect(names(0)).toEqual(['node:games', 'create', 'none']);
  expect(fs.readFileSync(env.historyPath)).toEqual(before);
});
it('ranks an actual recorded launch first on the next menu without creating a usage store', async () => {
  agentWorkspace('alpha.lead');
  agentWorkspace('zeta.lead');
  const config = JSON.parse(fs.readFileSync(env.configPath, 'utf8'));
  config.profiles.fixture = { executable: process.execPath, args: ['-e', 'process.exit(0)'] };
  fs.writeFileSync(env.configPath, JSON.stringify(config));
  expect(
    await runCommand('fixture', [], {
      usePty: true,
      detached: true,
      recordLaunch: true,
      sessionKey: 'workspace_usage_fixture',
      workspace: 'zeta.lead',
    })
  ).toBe(0);
  answer({ workspace: 'none' });
  await chooseSessionWorkspace(source);
  expect(names(0)).toEqual(['node:zeta', 'node:alpha', 'create', 'none']);
});

it('browses real Enquirer project and agent menus in a disposable terminal without launching an agent', async () => {
  agentWorkspace('rsg.lead');
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
        frame.includes(stage === 0 ? 'Select a Workspace project' : 'Select an agent in rsg') &&
        frame.includes('Without workspace (normal profile/current directory)')
      ) {
        if (stage === 0) firstPage = frame;
        stage++;
        frame = '';
        terminal.write('\r');
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
    expect(output).not.toContain('node:');
    expect(output).not.toContain('Remember ');
    expect(output).toContain('SELECTED:rsg.lead');
    expect(stage).toBe(2);
  } finally {
    clearTimeout(timeout);
    terminal.kill();
  }
}, 20000);

it('creates an agent through the real Enquirer selector and confirmation without instruction prompts', async () => {
  const repository = path.join(__dirname, '..');
  execFileSync('npm', ['run', '-s', 'build'], { cwd: repository, stdio: 'pipe' });
  const script = `require(${JSON.stringify(path.join(repository, 'dist/commands/workspace-select.js'))}).chooseSessionWorkspace().then(w => {console.log('CREATED:' + w.selector); process.exit(0)}).catch(e => {console.error(e.message); process.exit(1)});`;
  let stage = 0,
    frame = '',
    output = '';
  const steps = [
    ['Without workspace (normal profile/current directory)', '\r'],
    ['New Workspace selector (<project>.<agent>)', '\r'],
    ['Create Workspace agentvm.lead?', 'y\r'],
  ];
  const terminal = createPty({
    file: process.execPath,
    args: ['-e', script],
    cwd: source,
    detached: true,
    env: { AIRELAY_CONFIG: env.configPath },
    onOutput: (chunk) => {
      output += chunk;
      frame += chunk;
      if (stage < steps.length && frame.includes(steps[stage][0])) {
        const input = steps[stage++][1];
        frame = '';
        terminal.write(input);
      }
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(
      await Promise.race([
        terminal.exitCode,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Creation fixture did not exit')), 10000);
        }),
      ])
    ).toBe(0);
    expect(output).toContain('CREATED:agentvm.lead');
    expect(output).not.toContain('Instructions file');
    expect(output).not.toContain('Set settings.workspaceProjects');
    expect(output).not.toContain('Create agent Workspace');
    expect(output).not.toContain(source);
    expect(output).not.toContain('Remember ');
    expect(stage).toBe(3);
    expect(fs.readFileSync(env.configPath, 'utf8')).not.toContain('workspaceProjects');
    const selected = resolveSessionWorkspace('agentvm.lead', root);
    expect(selected.path).toBe(path.join(root, 'agentvm/agents/lead'));
    expect(
      JSON.parse(fs.readFileSync(path.join(selected.path, '.airelay-workspace.json'), 'utf8'))
        .binding
    ).toEqual({ project: 'agentvm', agent: 'lead' });
  } finally {
    clearTimeout(timeout);
    terminal.kill();
  }
}, 20000);
