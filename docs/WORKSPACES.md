# Agent Workspaces

## Profile, Session, Workspace

```bash
airelay start devin --key rsg-lead --workspace rsg.lead
airelay start devin --key bb-worker-01 --workspace bb_splunk.instances.worker-01 --detached
airelay attach bb-worker-01
airelay resume bb-worker-01
```

A **Profile** selects a harness/account. A **Session** owns a key, native ID and
runtime. A **Workspace** selects managed instructions, Skills and the actual
child working directory. One `devin` profile can run concurrent sessions in
different Workspaces. Airelay does not generate `workspace-*` profiles.

Without `--workspace` (`-w`), the existing profile/current-directory launch and
inherited environment behavior are unchanged. This does not restore MCP removed
by an operator. Managed verification currently supports native **Devin only**;
other executables fail closed, not falsely verified.

## Selectors and Stable Paths

Dots map to directory separators, not a configuration object:

```text
rsg.lead                       -> <root>/rsg/lead
bb_splunk.roles.lead            -> <root>/bb_splunk/roles/lead
bb_splunk.agents.worker1        -> <root>/bb_splunk/agents/worker1
bb_splunk.instances.worker-01   -> <root>/bb_splunk/instances/worker-01
```

Selectors contain 2-8 alphanumeric/underscore/hyphen segments, at most 64
characters each. Traversal, slash paths, symlink ancestors, nested managed
workspaces and missing/altered manifests/assets are rejected. Real paths are
checked; names alone are insufficient.

Fresh installations default to `~/.airelay/workspaces`:

```bash
airelay config set settings.workspaceRoot /absolute/path/to/workspaces
airelay workspace list --json
```

The installed host keeps `/home/therceman/agent-workspaces` explicitly configured.
Nothing is moved automatically. The interactive **Start** launcher offers
hierarchical Workspace selection and an explicitly confirmed storage-root change.

### Interactive Start

Run `airelay` from the source checkout, choose **Start**, then a normal Profile:

```text
Select a Workspace project
  bb_splunk
  rsg
  Create new Workspace...
  Without workspace (normal profile/current directory)
  Change workspace root...
```

Select a project to see only its immediate children; for example,
`bb_splunk` -> `instances` -> `worker-01`. **Back** returns one level.
Selecting a managed leaf passes its verified binding to the existing launch
path. Profile, Session and Workspace remain independent.

**Create new Workspace...** is available even when the list is empty, and
inside project branches. Enter a selector such as `agentvm.lead` or
`agentvm.roles.worker`, optionally choose an instructions file (relative to
the original source directory), then explicitly confirm the creation plan.
Without a file, Airelay creates a minimal canonical `AGENTS.md` referring to
that source checkout. Skills and both MCP files start empty. Source files,
existing Workspace directories and Profiles are never overwritten by this flow.
Use `workspace provision --role-workspace` for instances sharing an existing
Role's assets; the launcher creates canonical Roles, not duplicate Agent copies.
Native managed-launch verification still applies: creation does not bypass
global MCP/Skill checks or authorize any tools.

After selection/creation, an optional confirmation remembers the original
source directory -> project association in `settings.workspaceProjects`:

```yaml
settings:
  workspaceProjects:
    - source: /mnt/w/devin_folder/agentvm
      root: /home/user/agent-workspaces
      project: agentvm
```

The launcher canonicalizes the source's real path. Later launches from that
directory or its descendants open the associated project branch, **not a
preselected Role**. The longest matching explicit ancestor wins. Sibling path
prefixes do not match. You can still go Back, select another project, or launch
without a Workspace. Merely browsing never writes configuration. Associations
are launcher hints only; they never change a session's immutable binding or
affect explicit CLI `start`/`resume` behavior.

Associations retain the resolved absolute storage root. A changed global root
or missing project disables that hint rather than redirecting it. At most 128
source associations are accepted; an exact source can have only one project.
Inspect them using `airelay config list`; clear them using
`airelay config set settings.workspaceProjects '[]'`, or replace the array with
validated YAML/JSON through the same config command.

A session saves `{selector, root, path}` in existing session/history/runtime
metadata. `root` and `path` are resolved absolute paths. Resume, detached
supervision and wake use that saved binding, not the current global root.
An existing key cannot change Workspace or silently become unmanaged. Use a
new key or an explicitly reviewed migration. Old conflicting records fail
closed. Exiting/pruning a runtime retains managed binding/native metadata;
there is no workspace `sessions/` directory or second runtime registry.

## Provision Canonical Roles and Optional Agents

```bash
airelay workspace provision rsg.lead \
  --instructions /approved/rsg-lead-AGENTS.md \
  --skills-dir /approved/rsg-lead-skills --source /existing/rsg/checkout --dry-run
airelay workspace provision rsg.lead \
  --instructions /approved/rsg-lead-AGENTS.md \
  --skills-dir /approved/rsg-lead-skills --source /existing/rsg/checkout

airelay workspace provision bb_splunk.roles.worker \
  --instructions /approved/worker-AGENTS.md --skills-dir /approved/worker-skills
airelay workspace provision bb_splunk.agents.worker1 \
  --role-workspace bb_splunk.roles.worker --principal worker-01
airelay workspace provision bb_splunk.agents.worker2 \
  --role-workspace bb_splunk.roles.worker --principal worker-02
```

One Role owns `AGENTS.md` and `.devin/skills/`. Optional Agent directories link
only those canonical assets. Private `.devin/mcp_config.local.json` is a regular
0600 per-Agent file, never a credential symlink. Principal labels do not create
credentials, principals, entitlements or connections. One Role can also run
multiple sessions directly; instances are optional.

A manifest records hashes, modes, the logical Project/Role/optional instance,
and optional canonical Role selector. `--dry-run`/`-n` writes nothing. Repeated
provisioning is idempotent; changes require `--update` and unchanged managed
inputs. User edits/unmanaged target files are not overwritten. Updates have
bounded file/byte limits and rollback. Shared Role updates invalidate modified
Agent links/digests until explicitly reprovisioned. Source repositories are
referenced, never copied or moved.

## Zero MCP and Native Verification

```bash
airelay workspace inspect rsg.lead --json
airelay workspace verify rsg.lead --profile devin --json
```

**Current Owner target is ZERO MCP everywhere.** New provisioned workspaces
contain empty public/private MCP configuration. The public provision command
does not import MCP credentials. Managed launch rejects a manifest approving
any MCP server and rejects any effective native MCP discovery, including
global/imported registrations. It does not hide global settings with another
HOME/XDG overlay. No BB-MCP or gpt-tunnel reconnection is automatic.

Before each initial launch and wake, Airelay verifies files and runs native
`devin mcp list`, `skills list --json`, `rules list`, and `rules show AGENTS`.
Only approved Role Skills (plus product built-ins) and canonical instructions
may resolve. Native checks share a 10s deadline and bounded output; failure
output is not echoed because it can contain secrets. Unknown CLI output or
unsupported native configuration fails closed before spawning the agent.

Managed sessions inherit an explicit environment allowlist: real HOME/login
identity, PATH/shell, terminal and locale fields, plus Airelay state path
selectors. Profile HOME/USER/LOGNAME overrides, foreign MCP credentials,
config-root variables and arbitrary environment overrides are rejected.
Provider authentication remains the native Devin login under the real HOME;
no authentication files are copied/symlinked. The lowest PTY spawn boundary
uses this complete filtered environment without re-merging the parent. Unmanaged
profiles retain ordinary inheritance.
Only documented native resume/model/permission/sandbox/trust options are
accepted; alternate runtime/config-root overrides are rejected.

On the installed host, eight global Devin MCP aliases and a foreign uploaded
Skill still block managed launches. Prepared local MCP files are empty, but
**effective zero MCP is not yet verified under real HOME**. See the cutover
runbook; do not treat a successful isolated fixture as host migration evidence.

## Retired Generated Profiles

Old `profiles.<name>.workspace` is rejected with an actionable migration error;
it is not an alternate live configuration model:

```bash
airelay workspace migrate-profiles --dry-run --json
airelay workspace migrate-profiles --json
```

This explicit utility removes only exact, unused, unmodified generated profiles,
backs up original configuration privately, preserves permissions/ownership and
pins the former implicit `~/agent-workspaces` root. It checks saved/history/
detached references and Linux live process arguments. Referenced or edited
profiles are preserved and require reviewed session metadata migration; the
utility never stops processes or changes native IDs. Concurrent config edits
abort replacement. No workspace files or credentials are deleted.

This host's nine unused generated profiles have already been removed with a
protected backup. Normal harness profiles and active processes were preserved.

## Security and Future Reconnection

Workspace/path/Profile/key/Skills/instructions are **not authorization**.
Local discovery prevents accidental cross-project tool exposure, not same-UID
secret access. Agents running as the same Unix user can read that user's files.
Backend authentication and distinct immutable identities/entitlements remain
necessary.

### Future BB-MCP reconnection (not implemented or approved)

Exactly one HTTP daemon/endpoint, local alias `bb-mcp`, and one unique header
Bearer credential per authorized concrete BB agent. Server-side authentication
maps credentials to immutable identities/roles/entitlements. Never authorize by
alias/path/session key or client `role` query parameter; never put secrets in
URLs. Workers share canonical instructions/Skills, not credentials. No global
or unrelated-project registration.

## Verification and Systemic Audit

```bash
npm test -- --runInBand workspace json-store resume detached
npm run build
node scripts/verify-workspace-devin.cjs
```

The installed-Devin script uses disposable HOME/workspaces and dummy credentials,
performs native discovery/negative checks, and makes no model/service calls.
Automated PTY tests cover concurrent same-profile sessions, independent wake,
restart/root stability, detached supervisor transfer and immutable key binding.

| Candidate | Classification | Action | Evidence |
| --- | --- | --- | --- |
| Provision/config | Replaced profile ownership | Provision assets only; reject retired Profile field | Workspace/CLI/migration tests |
| CLI start/launcher | Session parameter | Freeze selector to absolute binding | CLI/launcher tests |
| Launcher project browsing | Flat list replaced | Immediate children only; Back and creation at each branch | Hierarchical launcher/creation tests |
| Source-folder discovery | Explicit suggestion, not authority | Longest canonical source ancestor, current storage root, explicit confirmation | Association/root/sibling/symlink tests |
| Explicit CLI/resume/wake | Intentional exception to launcher hints | Never consult source associations; use explicit/saved binding | CLI/resume/two-session wake tests |
| Launcher provisioning | Existing provisioner reused | Dry-run then confirmation, zero MCP, no Profile/source overwrite | Empty-list creation/cancellation/asset checks |
| Initial runtime | Required fail-closed boundary | Verify native inventory before reservation/spawn | Native preflight tests/script |
| Concurrent sessions | Required atomicity | Transactional stores and live-key reservation | Cross-process store + two-PTY tests |
| Detached parent/child | Required stable-path transfer | Pass frozen binding across supervisor boundary | Detached Workspace test |
| Registry/history/finalization/rename | Required immutability | Preserve binding/native ID and reject reassignment | Session/history/rename tests |
| Pruning | Async lost-update risk | Re-read after probe; retain managed binding | Concurrent-prune regressions |
| Resume/account switch | Profile independent of Workspace | Pass saved binding without root re-resolution | Resume tests |
| Wake/restart | Generation boundary | Reverify saved path each generation | Two-session wake/root-change test |
| Filesystem/env | Existing policy reused | Enforce digest/link/native allowlist checks | Negative workspace tests |
| Retired profiles | Removal-only migration exception | Block used/edited profiles; back up unused exact matches | Migration tests/protected host backup |
| Unmanaged profiles | Explicit compatibility exception | Preserve cwd/env/lifecycle, never restore MCP implicitly | Existing runtime/env/full suite |
| Host zero-MCP | Operationally BLOCKED, not code-ready proof | Disclose global/active-consumer blockers; do not stop work | Real-HOME inventory/cutover runbook |


Session/history/detached mutations use synchronous bounded store transactions
(1s lock-acquisition limit) and atomic file replacement. A crash leaving a
`.lock` directory fails closed with an inspection instruction; do not remove
it until the owning writer is confirmed gone. Invalid state is not silently
overwritten. Managed saved bindings are not silently evicted by the existing
50-session/profile limit; review inactive records before explicit migration
if that bound is reached. These locks coordinate current writers, not old
in-memory runtimes; obsolete controllers still require the safe P2 cutover.
