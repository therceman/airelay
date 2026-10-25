#!/usr/bin/env node
// Installed native CLI discovery only: disposable HOME, no model/service calls.
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
    const home = path.join(fixture, 'home'), root = path.join(fixture, 'workspaces');
    fs.mkdirSync(home);
    const env = { HOME: home, PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color' };
    const version = spawnSync('devin', ['--version'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(version.status, 0, 'Install Devin before running this optional gate.');
    const selectors = ['rsg.lead', 'bb_splunk.lead', 'bb_splunk.worker1', 'bb_splunk.worker2', 'bb_splunk.advisor'];
    for (const selector of selectors) {
      const [project, agent] = selector.split('.');
      const { directory } = provisionWorkspace({ project, agent, root });
      fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# Agent-maintained instructions\nUse fixture data only.\n');
      fs.mkdirSync(path.join(directory, '.devin/skills/local-guide'));
      fs.writeFileSync(path.join(directory, '.devin/skills/local-guide/SKILL.md'), '---\nname: local-guide\ndescription: Disposable agent Workspace proof.\n---\nUse fixture data only.\n');
    }
    const inspect = selector => verifyNativeWorkspace({ executable: 'devin' }, resolveSessionWorkspace(selector, root), 'devin', env);
    const inventories = selectors.map(inspect);
    for (const inventory of inventories) {
      assert.deepEqual(inventory.mcpServers, []);
      assert.deepEqual(inventory.skills, ['local-guide']);
      assert.equal(inventory.instructionsVerified, true);
    }
    assert.deepEqual(selectors.map(inspect), inventories);
    // No reprovisioning: discover a new Skill and edited instructions directly.
    const first = resolveSessionWorkspace(selectors[0], root).path;
    fs.appendFileSync(path.join(first, 'AGENTS.md'), 'Updated by the agent.\n');
    fs.mkdirSync(path.join(first, '.devin/skills/new-guide'));
    fs.writeFileSync(path.join(first, '.devin/skills/new-guide/SKILL.md'), '---\nname: new-guide\ndescription: Agent-added guide.\n---\nFixture only.\n');
    assert.deepEqual(inspect(selectors[0]).skills, ['local-guide', 'new-guide']);
    const concurrent = await Promise.all(selectors.slice(0, 2).map(selector => promisify(execFile)('devin', ['mcp', 'list'], { cwd: resolveSessionWorkspace(selector, root).path, env, timeout: 10000, maxBuffer: 256*1024 })));
    for (const result of concurrent) assert.match(result.stdout, /No MCP servers configured/);
    const global = path.join(home, '.config/devin'); fs.mkdirSync(global, { recursive: true });
    fs.writeFileSync(path.join(global, 'mcp_config.json'), '{"mcpServers":{"foreign-project":{"command":"/bin/false"}}}');
    assert.throws(() => inspect(selectors[0]), /zero MCP/);
    fs.unlinkSync(path.join(global, 'mcp_config.json'));
    fs.mkdirSync(path.join(global, 'skills/foreign-guide'), { recursive: true });
    fs.writeFileSync(path.join(global, 'skills/foreign-guide/SKILL.md'), '---\nname: foreign-guide\ndescription: Foreign project negative fixture.\n---\nDo not load.\n');
    assert.throws(() => inspect(selectors[0]), /foreign or unexpected Skill/);
    fs.rmSync(path.join(global, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(global, 'AGENTS.md'), '# Foreign global instructions\n');
    assert.throws(() => inspect(selectors[0]), /foreign or unexpected always-on instructions/);
    console.log(JSON.stringify({ version: version.stdout.trim(), agentsVerified: selectors.length, zeroMcpFixture: true, agentOwnedEditsVerified: true, repeatedNativeDiscovery: true, concurrentSameProfileWorkspaces: 2, foreignMcpRejected: true, foreignSkillRejected: true, foreignInstructionsRejected: true, modelCalls: 0 }));
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}
main().catch(() => { console.error('Installed-Devin Workspace verification failed; inspect disposable configuration without exposing credentials.'); process.exitCode = 1; });
