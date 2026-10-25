#!/usr/bin/env node
// Optional installed-CLI integration gate. Uses dummy credentials and an isolated HOME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { provisionWorkspace } = require('../dist/workspace/provision');
const { verifyNativeWorkspace } = require('../dist/workspace/verify');
const { resolveSessionWorkspace } = require('../dist/workspace/binding');

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-devin-workspace-'));
  try {
    const home = path.join(fixture, 'home');
    const root = path.join(fixture, 'workspaces');
    fs.mkdirSync(home);
    const env = { HOME: home, PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color' };
    const version = spawnSync('devin', ['--version'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(version.status, 0, 'Install Devin before running this optional integration gate.');
    const instructions = path.join(fixture, 'instructions.md');
    fs.writeFileSync(
      instructions,
      '# Disposable role\nUse only the approved dummy project configuration.\n'
    );
    const skills = path.join(fixture, 'skills');
    fs.mkdirSync(path.join(skills, 'role-guide'), { recursive: true });
    fs.writeFileSync(
      path.join(skills, 'role-guide/SKILL.md'),
      '---\nname: role-guide\ndescription: Disposable workspace discovery proof.\n---\nUse only fixture data.\n'
    );
    for (const [project, role] of [
      ['rsg', 'lead'],
      ['bb_splunk', 'lead'],
      ['bb_splunk', 'worker'],
      ['bb_splunk', 'advisor'],
    ]) {
      let mcpConfig;
      if (project === 'bb_splunk' && role !== 'worker') {
        mcpConfig = path.join(fixture, `${role}.json`);
        fs.writeFileSync(
          mcpConfig,
          JSON.stringify({
            mcpServers: {
              'dummy-bb-mcp': { command: '/bin/false', env: { DUMMY_IDENTITY: role } },
            },
          }),
          { mode: 0o600 }
        );
      }
      provisionWorkspace({ project, role, root, instructions, skillsDir: skills, mcpConfig });
    }
    for (const instance of ['worker-01', 'worker-02']) {
      const file = path.join(fixture, `${instance}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({
          mcpServers: {
            'dummy-bb-mcp': { command: '/bin/false', env: { DUMMY_IDENTITY: instance } },
          },
        }),
        { mode: 0o600 }
      );
      provisionWorkspace({
        project: 'bb_splunk',
        role: 'worker',
        instance,
        root,
        mcpConfig: file,
        principalRef: instance,
      });
    }
    const bindings = [
      { project: 'rsg', role: 'lead' },
      { project: 'bb_splunk', role: 'lead' },
      { project: 'bb_splunk', role: 'worker', instance: 'worker-01' },
      { project: 'bb_splunk', role: 'worker', instance: 'worker-02' },
      { project: 'bb_splunk', role: 'advisor' },
    ];
    const selector = (binding) =>
      binding.instance
        ? binding.project + '.instances.' + binding.instance
        : binding.project + '.' + binding.role;
    const inspect = (binding) =>
      verifyNativeWorkspace(
        { executable: 'devin' },
        resolveSessionWorkspace(selector(binding), root),
        'devin',
        env
      );
    assert.deepEqual(inspect(bindings[0]).mcpServers, []);
    for (const binding of bindings.slice(1)) assert.throws(() => inspect(binding), /zero MCP/);
    const firstSkill = path.join(
      root,
      'bb_splunk/instances/worker-01/.devin/skills/role-guide/SKILL.md'
    );
    const secondSkill = path.join(
      root,
      'bb_splunk/instances/worker-02/.devin/skills/role-guide/SKILL.md'
    );
    assert.equal(fs.realpathSync(firstSkill), fs.realpathSync(secondSkill));
    // Temporary host target: remove MCP from every role and concrete instance.
    // Preserve the general provisioner contract; this uses only dummy identities.
    for (const role of ['lead', 'worker', 'advisor'])
      provisionWorkspace({
        project: 'bb_splunk',
        role,
        root,
        instructions,
        skillsDir: skills,
        update: true,
      });
    for (const instance of ['worker-01', 'worker-02'])
      provisionWorkspace({ project: 'bb_splunk', role: 'worker', instance, root, update: true });
    const inventories = bindings.map(inspect);
    for (const inventory of inventories) assert.deepEqual(inventory.mcpServers, []);
    assert.deepEqual(
      bindings.map(inspect),
      inventories,
      'Same native Devin profile discovers stable independent Workspace configurations.'
    );
    assert.equal(fs.realpathSync(firstSkill), fs.realpathSync(secondSkill));
    const concurrent = await Promise.all(
      bindings.slice(0, 2).map((binding) =>
        promisify(execFile)('devin', ['mcp', 'list'], {
          cwd: resolveSessionWorkspace(selector(binding), root).path,
          env,
          timeout: 10000,
          maxBuffer: 256 * 1024,
        })
      )
    );
    for (const result of concurrent) assert.match(result.stdout, /No MCP servers configured/);
    const globalConfig = path.join(home, '.config/devin');
    fs.mkdirSync(globalConfig, { recursive: true });
    fs.writeFileSync(
      path.join(globalConfig, 'mcp_config.json'),
      '{"mcpServers":{"foreign-project":{"command":"/bin/false"}}}'
    );
    assert.throws(() => inspect(bindings[0]), /MCP inventory differs/);
    fs.unlinkSync(path.join(globalConfig, 'mcp_config.json'));
    fs.mkdirSync(path.join(globalConfig, 'skills/foreign-guide'), { recursive: true });
    fs.writeFileSync(
      path.join(globalConfig, 'skills/foreign-guide/SKILL.md'),
      '---\nname: foreign-guide\ndescription: Foreign project negative fixture.\n---\nDo not load in this workspace.\n'
    );
    assert.throws(() => inspect(bindings[0]), /foreign or unexpected Skill/);
    fs.rmSync(path.join(globalConfig, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(globalConfig, 'AGENTS.md'), '# Foreign global instructions\n');
    assert.throws(() => inspect(bindings[0]), /foreign or unexpected always-on instructions/);
    console.log(
      JSON.stringify({
        version: version.stdout.trim(),
        rolesVerified: bindings.length,
        zeroMcpFixture: true,
        sharedWorkerSkill: true,
        distinctDummyIdentities: true,
        zeroMcpCutoverVerified: bindings.length,
        repeatedNativeDiscovery: true,
        concurrentSameProfileWorkspaces: 2,
        foreignMcpRejected: true,
        foreignSkillRejected: true,
        foreignInstructionsRejected: true,
        modelCalls: 0,
      })
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error(
    'Installed-Devin workspace verification failed; inspect disposable configuration without exposing credentials.'
  );
  process.exitCode = 1;
});
