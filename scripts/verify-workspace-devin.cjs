#!/usr/bin/env node
// Optional native discovery evidence, not a product launch policy. No model/service calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { provisionWorkspace } = require('../dist/workspace/provision');
const { resolveSessionWorkspace, verifySessionWorkspace } = require('../dist/workspace/binding');
async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-devin-workspace-'));
  try {
    const home = path.join(fixture, 'home'), root = path.join(fixture, 'workspaces');
    fs.mkdirSync(home);
    const env = { HOME: home, PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color' };
    const read = (cwd, ...args) => {
      const result = spawnSync('devin', args, { cwd, env, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024 });
      assert.equal(result.status, 0, 'Native discovery did not complete.');
      return result.stdout;
    };
    const version = read(fixture, '--version').trim();
    const selectors = ['rsg.lead', 'bb_splunk.lead', 'bb_splunk.worker1', 'bb_splunk.worker2', 'bb_splunk.advisor'];
    for (const selector of selectors) {
      const [project, agent] = selector.split('.');
      const { directory } = provisionWorkspace({ project, agent, root });
      assert.equal(fs.existsSync(path.join(directory, '.devin')), false);
      fs.mkdirSync(path.join(directory, '.devin/skills/local-guide'), { recursive: true });
      fs.writeFileSync(path.join(directory, '.devin/skills/local-guide/SKILL.md'), '---\nname: local-guide\ndescription: Disposable discovery fixture.\n---\nFixture only.\n');
      assert.ok(JSON.parse(read(directory, 'skills', 'list', '--json')).some(skill => skill.name === 'local-guide'));
    }
    const first = resolveSessionWorkspace(selectors[0], root).path;
    const global = path.join(home, '.config/devin');
    fs.mkdirSync(path.join(global, 'skills/global-guide'), { recursive: true });
    fs.writeFileSync(path.join(global, 'skills/global-guide/SKILL.md'), '---\nname: global-guide\ndescription: Global discovery fixture.\n---\nFixture only.\n');
    fs.writeFileSync(path.join(global, 'AGENTS.md'), '# Global fixture instructions\n');
    fs.writeFileSync(path.join(global, 'mcp_config.json'), '{"mcpServers":{"global-tool":{"command":"/bin/false"}}}');
    const local = path.join(first, '.devin/mcp_config.local.json');
    const config = '{"mcpServers":{"local-tool":{"command":"/bin/false","env":{"FIXTURE_CREDENTIAL":"dummy-private-credential"}}}}';
    fs.writeFileSync(local, config, { mode: 0o600 });
    for (const selector of selectors) verifySessionWorkspace(resolveSessionWorkspace(selector, root));
    const inventory = read(first, 'mcp', 'list');
    assert.match(inventory, /global-tool/);
    assert.match(inventory, /local-tool/);
    const skills = JSON.parse(read(first, 'skills', 'list', '--json'));
    assert.ok(skills.some(skill => skill.name === 'global-guide'));
    assert.ok(skills.some(skill => skill.name === 'local-guide'));
    assert.match(read(first, 'rules', 'list'), /AGENTS/);
    assert.equal(fs.readFileSync(local, 'utf8'), config);
    const concurrent = await Promise.all(selectors.slice(0, 2).map(selector => promisify(execFile)('devin', ['mcp', 'list'], { cwd: resolveSessionWorkspace(selector, root).path, env, timeout: 10000, maxBuffer: 256 * 1024 })));
    for (const result of concurrent) assert.match(result.stdout, /global-tool/);
    console.log(JSON.stringify({version, agentsVerified: selectors.length, nativeScaffoldNotGenerated: true, configuredMcpAccepted: true, globalSkillsAccepted: true, globalInstructionsAccepted: true, nativeConfigurationPreserved: true, concurrentSameProfileWorkspaces: 2, modelCalls: 0}));
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}
main().catch(() => { console.error('Installed-Devin Workspace fixture failed; native output is suppressed to protect configuration contents.'); process.exitCode = 1; });
