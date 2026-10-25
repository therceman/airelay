# Zero-MCP Cutover: Linux Host

## Current Owner Decision

**Temporary target: zero MCP connections everywhere.** This supersedes the
previous plan to keep separate BB aliases in local Role/Instance files.
Remove all eight global Devin registrations and every managed local
registration, but only after dependent controllers and Jobs are safe to cut
over. The Owner subsequently authorized immediate cutover with no further
approval required, subject to verified technical quiescence. Do not interrupt
real active work or infer quiescence from an idle TUI.

The future reconnection contract is in
[WORKSPACES.md](WORKSPACES.md#future-bb-mcp-reconnection-not-implemented-or-approved):
one HTTP daemon/endpoint, local alias `bb-mcp`, unique header Bearer per concrete
agent, server-owned immutable identity/role/entitlements. Aliases, paths and
query parameters are never authorization. This task does not reconnect
clients, rotate credentials or consolidate existing daemons.

## Applied Safe Preparation

- Installed at inventory: Airelay `0.1.169`, Devin `3000.11.205 (6dea39440ae3)`.
  See Git for the runbook/test patch version.
- All **nine** workspace manifests were discovered from disk and cross-checked
  against registered workspace profiles. There were **zero** live
  processes/controllers using those directories before editing.
- Both MCP files in every workspace now contain `{"mcpServers":{}}`;
  `allowedMcpServers` is `[]` in every manifest. Updates used the existing
  digest-checked provisioner, with dry-run first and private backup/rollback.
- Canonical instructions, Skill hashes, instance links, profiles, native
  authentication and ordinary preferences were checked unchanged.
- No controller or harness was stopped, restarted, attached to or sent input.
  No daemon, identity registry, durable Job, lease or canonical data changed.

```text
~/agent-workspaces/
  rsg/lead/
  bb_splunk/{lead,worker,advisor,research,watcher,dev}/
  bb_splunk/instances/{worker-01,worker-02}/
```

Both Workers still share canonical Worker instructions/Skills. Former distinct
credentials remain in protected backups, not active local registrations.
Principal labels are nonsecret references, not connections or permission grants.
Source checkouts remain in their original locations.

## Remaining Exposure and Blockers

**Global aliases removed: none.** These eight remain pending safe cutover:

```text
bb-mcp-lead
bb-mcp-worker
bb-mcp-worker2
bb-mcp-research
bb-mcp-watcher
bb-mcp-advisor
bb-mcp-dev
gpt-tunnel
```

After local cleanup, real-HOME `devin mcp list` was run in **13 contexts**:
all nine workspaces, RSG checkout, BB-Splunk checkout, unrelated `rust-ui`
checkout and HOME. **Every context still discovered 8**, inherited globally.
Effective zero-MCP is NOT verified. Local files cannot override Devin's global
merge. No configuration was hidden to obtain a false zero result. Managed
native launch preflight remains fail-closed.

Read-only inventory found **16 live registered controllers**, 15 using Devin
and one Codex. Devin consumers include RSG, BB-Splunk, rust-ui, bb-tips, agentvm
and zreport; both running and intentionally hibernated controllers count.
A detached `bb_splunk_worker_2` and standalone Devin processes also exist.
Most old Devin controllers report `0.1.165`-`0.1.166`. Their keys, PIDs, native
IDs and directories are recorded privately. Re-inventory at the window:
these observations are not permanent PID authority.

Two BB-MCP listeners exist on loopback **8090 and 8190**; neither was changed.
The subsequent Owner-authorized read-only audit (2026-10-23 19:40-19:46 UTC)
queried both authoritative endpoints: 8090 revision 14381 remained stable,
196 Jobs, campaign CLOSED, zero live claims/leases; five RUNNING records had no
live claims. Port 8190 revision 9 had zero Jobs/leases. No Job was mutated.
However, native activity sampling proved ongoing work in `rust-ui-lead`:
11 new message nodes in 10 seconds. Disruptive global cutover therefore stopped
on a **technical active-consumer blocker**, not missing Owner approval.
Those are timestamped observations, not current quiescence authority.
Protected evidence is in
`~/agent-workspace-backups/2026-10-23T19-40-45-authorized-cutover/`.

Additional blockers:

- The detached Worker's registry locator is not proven to be its native Devin
  resume ID. Do not use a runtime UUID as a native session ID; verify/save it
  from durable native metadata before stopping that consumer.
- Account-uploaded Skill `default:pwa-tablet-testing` still lacks an approved
  canonical destination. This decision is MCP-only; no Skill was deleted.
  Foreign Skills must still fail native workspace preflight after MCP cleanup.
- The BB checkout references missing `SUBAGENTS.md`. Do not invent that policy
  or infer BB operational authorization from prepared directories.

## Protected Backup and Rollback

Fresh backup root, mode 0700:

```text
~/agent-workspace-backups/2026-10-23T19-12-38-zero-mcp/
  files/manifest.json
  files/<number>.backup
  local-dry-run.json
  cutover-evidence.json
  controller-cutover-plan.json
  prepare-zero-mcp.cjs
```

It includes original local MCP files/manifests, unchanged global eight-alias
file, relevant native settings, Airelay config and registry snapshots.
The manifest records original paths, hashes, modes and ownership. Evidence
contains metadata only, including the local rollback file list and real-HOME
inventory. Registry snapshots are evidence, **not** files to restore over
live registries. No credential values are printed or committed.
The per-controller plan proposes six existing Role-profile destinations and
explicitly leaves Worker-instance mapping and unrelated-role decisions open;
it contains no automatic stop commands or approved window.

Earlier backup remains at
`~/agent-workspace-backups/2026-10-23T17-58-44-400Z/`, including protected
credential templates and original assets. Its `prepare-workspaces.cjs`
implements the superseded nonzero target: **do not rerun it**. Backups are
retained for future approved recovery/reconnection/rotation.

Selective local rollback, from the Airelay repository, only after reviewing
new consumers and independent edits:

```bash
export BACKUP="$HOME/agent-workspace-backups/2026-10-23T19-12-38-zero-mcp"
node <<'JS'
const fs = require('node:fs');
const { restoreWorkspaceConfiguration } = require('./dist/workspace/backup');
const audit = JSON.parse(fs.readFileSync(process.env.BACKUP + '/cutover-evidence.json', 'utf8'));
restoreWorkspaceConfiguration(process.env.BACKUP + '/files', audit.rollbackFiles);
JS
```

This restores former local registrations AND matching manifests. It is a
recovery operation, not approval to reconnect. Do not run it merely because
global cutover is deferred. Never roll back authentication/preferences or
whole session registries to undo an MCP edit.

## Exact Safe Cutover Procedure (Not Executed)

1. **Owner authorization already exists; recheck technical quiescence.** Freeze
   new dispatch and automatic wake/prompt producers using their existing
   operator controls. Keep daemons running. If new claims/wakes cannot be
   prevented, STOP. Airelay idle/busy is not durable-Job quiescence.
2. **Confirm authoritative current Jobs/claims/leases at both endpoints.**
   Account for in-flight subprocesses, heartbeat obligations and queued
   dispatch. Let work finish/checkpoint under its approved lifecycle. Do not
   cancel Jobs/release leases unilaterally. Save revision/status metadata
   privately. A stale snapshot or unknown endpoint state blocks cutover.
3. **Re-inventory running/hibernated controllers, detached registry and actual
   native processes, including standalone CLIs.** Save native session IDs,
   keys, profiles, original cwd/args and destination Role/Instance bindings.
   Validate PID identity. An absent harness is not an orphan. Resolve the
   detached Worker's native ID before shutdown.
4. **Gracefully quiesce reviewed consumers only when technical quiescence is verified.** Exit
   native CLIs/controllers through their normal owner-controlled shutdown.
   `airelay stop <key>` applies to detached runtimes only; do not blanket-kill
   PIDs. Confirm old controllers cannot wake with cached configuration.
   Preserve histories/auth. If any affected consumer cannot safely exit,
   defer removal. A build does not upgrade an in-memory old controller.
5. **Refresh private backups and review exact diffs.** Include current global
   MCP config, any new local/imported sources, managed manifests and launch
   metadata. Recheck hashes/permissions/ownership. Preserve credentials.
   Use the current dot-selector provision command with full canonical Role inputs
   and `--update`; MCP import is no longer a public provision option. Agents
   retain their canonical Role links.
   Abort on unmanaged/user edits; never rerun the obsolete staging script.
6. **Atomically clear all eight global aliases.** Preserve other top-level
   fields, ownership/mode, native auth and preferences. On this host the
   confirmed source is `~/.config/devin/mcp_config.json`. Only after steps
   1-5, the following edit validates the alias set and replaces that file;
   it neither contacts nor stops any daemon:

```bash
node <<'JS'
const fs = require('node:fs');
const file = process.env.HOME + '/.config/devin/mcp_config.json';
const before = fs.readFileSync(file);
const stat = fs.lstatSync(file);
if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid())
  throw Error('Review MCP configuration ownership/type before cutover');
const value = JSON.parse(before.toString());
const expected = ['bb-mcp-lead', 'bb-mcp-worker', 'bb-mcp-worker2',
  'bb-mcp-research', 'bb-mcp-watcher', 'bb-mcp-advisor', 'bb-mcp-dev', 'gpt-tunnel'].sort();
if (JSON.stringify(Object.keys(value.mcpServers || {}).sort()) !== JSON.stringify(expected))
  throw Error('Registration set changed; re-inventory before removal');
value.mcpServers = {};
const temporary = file + '.zero-mcp.tmp';
let created = false;
try {
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n',
    { mode: stat.mode & 0o777, flag: 'wx' });
  created = true;
  fs.chownSync(temporary, stat.uid, stat.gid);
  if (!fs.readFileSync(file).equals(before)) throw Error('Configuration changed during cutover');
  fs.renameSync(temporary, file);
} finally { if (created) fs.rmSync(temporary, { force: true }); }
JS
```

7. **Verify native discovery with unchanged real HOME.** Run `(cd <directory>
   && devin mcp list)` in every Role/Instance, original RSG/BB checkout,
   unrelated rust-ui, HOME, and any additional consumer directory. Require
   the native empty inventory; no temporary HOME/XDG overlay, no allowlisting
   unexpected registrations. Never dump secret-bearing config. Separately run
   `airelay workspace verify <project> <role> [--instance <name>] --json` for
   stricter Skill/instruction/MCP validation. Resolve foreign Skills rather
   than weakening that preflight.
8. **Controlled new starts, then native resume.** After full verification
   passes, start only owner-approved new consumers with registered workspace
   profiles/reviewed keys. Preserve known native IDs and correct cwd on
   resume/wake. Verify zero MCP again before returning dispatch. Do not wake
   an old MCP-dependent controller merely because history exists. Capture
   real startup/resume evidence before claiming production acceptance.
9. **Failure path:** keep dispatch frozen, quiesce new consumers safely, and
   selectively restore only MCP files and matching manifests changed during
   this window. Use `restoreWorkspaceConfiguration(backupFilesDirectory,
   reviewedPaths)` after comparing hashes; never restore entire native homes
   or registries. Verify restored discovery and relaunch old consumers only
   with owner approval. Keep all backups.

## Systemic Invariant Audit

Independent methods: registered bindings + bounded manifest discovery;
file/digest/link checks; live `/proc` cwd inspection and registry identities;
real native discovery under real HOME; socket inventory and read-only durable
snapshot/journal metadata. No global-zero claim comes from local files alone.

| Candidate | Classification | Action / Evidence |
| --- | --- | --- |
| Nine managed MCP file pairs/manifests | Safe local cutover | Zero; no live consumers; canonical assets unchanged |
| Eight global registrations | Deferred violation | Protected backup; window/consumer safety blocks removal |
| RSG/BB/unrelated/HOME native contexts | Global inheritance | All 13 tested contexts still discover 8 |
| Running and hibernated controllers | Wake/resume consumers | Inventory retained; none interrupted |
| Standalone Devin CLIs | Additional consumers | Include in approved window |
| Two daemons/endpoints | Protected infrastructure | Neither modified/consolidated |
| Durable Jobs/claims/leases | Safety authority unknown | Stale snapshot; current quiescence unproven |
| Credentials/native auth | Protected data | Backups retained; no revocation or token logs/URLs |
| Codex/OpenCode global configs | No confirmed MCP registrations | Preserved unchanged; no application reset |
| PWA Skill / missing BB policy | Separate blockers | No unauthorized deletion or relaxed preflight |
| Shared Worker assets | Canonical reuse | Same links/hashes retained |
| Future `bb-mcp` alias | Deferred architecture | Unique credentials/server identity; no alias/path/query authorization |

| Status | Result |
| --- | --- |
| WORKSPACE_PROVISIONER_READY | PASS: existing provisioner reused; zero-MCP/rollback coverage |
| LOCAL_WORKSPACE_MCP_CLEAN | PASS: 9 manifests and both MCP files each empty |
| GLOBAL_MCP_CLEAN | BLOCKED: 8 remain pending approved safe window |
| GLOBAL_CUSTOM_SKILLS_CLEAN | PARTIAL: PWA destination unapproved |
| RSG_LEAD_ZERO_MCP_VERIFIED | BLOCKED: real HOME discovers 8 |
| BB_SPLUNK_IDENTITY_ISOLATION_VERIFIED | DEFERRED: future reconnection/backend verification separate |
| START_RESUME_VERIFIED | PARTIAL: fixtures; no production cutover |
| EXISTING_SESSIONS_PRESERVED | PASS: no existing process interrupted |
| ROLLBACK_READY | PASS: private backups and tested selective restore |

## Verification Evidence

- `npm test -- --runInBand test/workspace.test.ts`: 20 tests passed, including
  `cuts roles and instances over to zero MCP with protected rollback and unchanged shared assets`.
- `node scripts/verify-workspace-devin.cjs`: installed Devin verifies five
  zero-MCP fixture contexts after removing their dummy registrations; no model
  calls. Foreign global MCP/Skills/instructions remain rejected.
- The exact atomic-edit runbook snippet was also executed against disposable
  HOME/configuration: eight dummy aliases removed, other fields/auth/mode
  retained, changed alias sets refused, pre-existing temporary file preserved.
- `npm run verify`: build, lint, format, 60 suites / 715 tests, audit zero
  vulnerabilities. Jest still reports the previously observed worker teardown
  warning; the focused workspace suite exits cleanly.
- Two later parallel pre-commit attempts failed unchanged wall-clock tests:
  `stabilizes detached public resize requests during startup` and
  `holds spaced resize oscillation after early output until startup grace expires`.
  Each saw an empty forwarded list at its fixed deadline. Isolated
  `npm test -- --runInBand test/spawn.test.ts` passed all 20 tests. A bounded
  audit of the entire spawn suite and coordinator found that fixed sleeps
  assume timely child output, while the actual release also waits for output
  quiet. A disposable delayed-first-output fixture demonstrates that a
  correctly held resize can outlast those assertion deadlines.
- For final release verification, run the unchanged native verify/hook with
  per-invocation single-CPU affinity (`taskset -c <allowed-cpu>`). Jest uses
  `os.availableParallelism()` and consequently one worker. No test, assertion,
  timeout, production behavior or repository runner configuration is changed;
  no hook is skipped. The default-parallel timing sensitivity remains a
  test-suite risk, not a reason to claim production cutover acceptance.
- This is verified preparation, **not** completed global-zero or real-session
  start/resume acceptance. The blocked statuses above are deliberate.

## Session-Parameter Migration (2026-10-24)

The nine unused, unmodified generated `workspace-*` profiles were removed after
checking saved/history/detached references and live process arguments. Original
configuration is protected at:

`~/agent-workspace-backups/2026-10-24T09-57-27-246Z-remove-generated-profiles/`

The existing root is now explicitly pinned to
`/home/therceman/agent-workspaces`. Normal profiles
`opencode, codex, opencode2, codex2, opencode3, devin` remain. No native IDs,
workspace assets, credentials or active processes were changed. This profile
cleanup is **not** global MCP cleanup: real-HOME native preflight still rejects
the eight effective global registrations.

Use `airelay start devin --key <new-key> --workspace rsg.lead` or
`--workspace bb_splunk.instances.worker-01` after global/Skill blockers are
resolved. Existing user sessions were not rebound. Restore the backed-up
Airelay config only after reviewing intervening edits; that restores retired
profiles, so the current CLI will request explicit profile migration again.
Do not restore whole registry snapshots over active sessions.
