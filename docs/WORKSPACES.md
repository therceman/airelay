# Project and Role Workspaces

Managed workspaces keep reusable role instructions and Skills in one place and
bind a normal Airelay profile to its launch directory. Native discovery checks
currently support Devin on Linux. Other existing profiles retain their normal
environment and launch behavior.

```text
~/agent-workspaces/
  rsg/lead/
    AGENTS.md
    .airelay-workspace.json
    .devin/
      skills/
      mcp_config.json
      mcp_config.local.json
  bb_splunk/
    worker/                         canonical role assets
    instances/worker-01/            optional, concrete agent identity
    instances/worker-02/            optional, concrete agent identity
```

There are no workspace `sessions/` directories or XDG overlays. Airelay's
existing registry owns sessions. Source checkouts stay at their existing paths.
The `instances/` directory is created only when an instance is requested.

## Provision and Inspect

Initialize Airelay normally first. Supply operator-approved instructions and a
directory whose immediate subdirectories contain Skills with `SKILL.md` files.

```bash
airelay workspace provision rsg lead \
  --instructions /path/to/approved/AGENTS.md \
  --skills-dir /path/to/approved/skills \
  --source ~/git/reposuite-gateway --dry-run

# Review the plan, then repeat without --dry-run.
airelay workspace provision rsg lead \
  --instructions /path/to/approved/AGENTS.md \
  --skills-dir /path/to/approved/skills \
  --source ~/git/reposuite-gateway

airelay workspace inspect rsg lead --json
airelay workspace verify rsg lead --json
```

The root defaults to `~/agent-workspaces`. Change it with:

```bash
airelay config set settings.workspaceRoot /absolute/path/to/agent-workspaces
```

Provisioning is idempotent. Changed managed assets require `--update`; the
previous materialization must still match its recorded digests. User edits or
unmanaged target files cause an error. `--dry-run` (or `-n`) writes neither
workspace files nor configuration. Reprovision with the complete desired input
set. The current Owner-approved host target is **zero MCP everywhere**;
omit `--mcp-config`, including when updating an existing workspace. This
empties its private MCP file and updates the manifest together. It does not
mask global registrations: native verification must still discover zero.

Each role owns one regular `AGENTS.md` and one copy of each Skill. Optional
instances link only those assets to the canonical role. Both MCP files contain
`{"mcpServers":{}}` in the temporary zero-MCP state. The private
`.devin/mcp_config.local.json` remains a regular mode-0600 file, never a
credential symlink. Preserve former credentials in a protected backup outside
active discovery directories, not in an active workspace registration.

```bash
airelay workspace provision bb_splunk worker \
  --instructions /path/to/worker/AGENTS.md --skills-dir /path/to/worker/skills

airelay workspace provision bb_splunk worker --instance worker-01 \
  --principal worker-a
airelay workspace provision bb_splunk worker --instance worker-02 \
  --principal worker-b
```

`--principal` is an optional nonsecret operator label, not a credential or
authorization grant. Provisioning never creates a backend Principal, account
or lab entitlement. The reusable provisioner still accepts `--mcp-config`
(`{"mcpServers": {...}}`); that capability is not approval to reconnect tools
during the zero-MCP cutover. No runtime/session policy is changed by this
operator migration target.

## Launch, Wake, and Resume

Provisioning registers an ordinary profile. Use the existing lifecycle commands:

```bash
airelay start workspace-rsg-lead --key rsg-lead --detached
airelay attach rsg-lead
airelay resume rsg-lead
```

An instance profile is named, for example,
`workspace-bb_splunk-worker-worker-01`. The profile's `workspace` binding stores
the project, role and optional instance. The actual child `cwd` is resolved
from that binding; a conflicting saved/configured `cwd` is rejected. Account
switching only offers profiles with the same harness and workspace binding.

Every managed harness generation, including wake, checks the current manifest
and uses native CLI inspection before launching:

- `devin mcp list`: the complete configured server-name set must equal the
  manifest, and each server must resolve from this workspace's private file.
- `devin skills list --json`: custom Skills must match the canonical role
  paths; native `Builtin` resources remain allowed.
- `devin rules list` and `devin rules show AGENTS`: exactly the canonical role
  instruction source must be discovered and its contents must match.

Native inspection has a total ten-second budget and bounded output. Its raw
stdout/stderr is never included in failure messages because native diagnostics
can contain secrets. Unexpected tools, Skills, rules, modified assets,
configuration-root overrides or an unrecognized inventory fail closed. The
supported managed launch options are native resume/continue, model, verbosity,
permission mode, sandbox, workspace-trust selection, and a prompt after `--`.

Devin's local MCP files **merge with global registrations**; an empty role
file does not hide global tools. A globally configured foreign server therefore
blocks a managed launch until its safe migration is complete. See
[Devin configuration precedence](https://docs.devin.ai/cli/reference/configuration/global-vs-local)
and [MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration).

## Environment and Security

Managed profiles inherit an explicit allowlist: `HOME`, user/login names,
`PATH`, `SHELL`, terminal identity/color variables, standard locale categories,
timezone, `WT_SESSION`, and Airelay's configuration/registry path overrides.
Foreign session identity variables are discarded; the runtime injects its own
session metadata afterward. Detached supervisors use the same environment
policy. No wildcard credential environment or XDG variables are inherited.

Authentication uses the native login store at the unchanged user `HOME`.
Managed profiles reject arbitrary credential environment overrides and
`--config`/cloud runtime switches. This implementation does not copy native
authentication stores into workspaces. Unmanaged profiles keep their existing
environment semantics.

This prevents accidental cross-project discovery when preflight passes. It is
**not strong secret isolation**: agents sharing one unrestricted Unix UID can
read each other's files and change their own manifests. Backend authorization
and distinct Principal credentials remain necessary. No credential broker,
container sandbox, RSG/RSR integration, ACP adapter or cloud authority is added.

## Migration and Rollback

The current cutover removes **all eight** global Devin MCP registrations and
every managed local registration; there are no BB-MCP or `gpt-tunnel`
exceptions. Before global removal, inventory sources/imports and consumers,
save private backups, and obtain the approved quiescent cutover window. A
hibernated controller is still a consumer because its next wake reuses its
launch configuration. Idle/busy and a historical Job snapshot do not prove
that durable Jobs or leases are quiescent.

Do not stop Jobs, revoke credentials, consolidate daemons or delete their
identity registry/durable data to achieve zero discovery. Unused prepared
workspaces can be emptied separately after checking live consumers. Full
zero-MCP acceptance requires real-HOME `devin mcp list` in every affected
context, not an empty local JSON file or a disposable-HOME fixture.

`src/workspace/backup.ts` records original paths, modes, ownership and hashes.
`restoreWorkspaceConfiguration(backupDirectory, [reviewedOriginalPaths])`
restores only selected files after validating backup hashes. Restore only files
changed by the migration; do not overwrite independently refreshed provider
authentication/preferences. Retain backups and any user-edited workspace files.

The host preparation status and outstanding cutover decisions are recorded in
[the migration report](WORKSPACE-MIGRATION-2026-10-23.md).

### Future BB-MCP Reconnection (Not Implemented or Approved)

The future target has exactly one HTTP daemon/endpoint. Each authorized
BB-Splunk concrete agent registers only the project-local alias `bb-mcp`, with
a unique Bearer credential in a header. The server resolves that credential
to an immutable agent identity, role and entitlements. Neither an alias,
workspace path nor a client-supplied `role` query parameter grants authority.
Never put credentials in URLs/query parameters. Two Workers share canonical
Role assets but not credentials. BB-MCP stays absent globally and from
unrelated projects. Reconnection and credential rotation require a separate
Owner-approved process; this cutover neither rotates nor revokes credentials.

## Verification

```bash
npm test -- --runInBand test/workspace.test.ts
npm run build
node scripts/verify-workspace-devin.cjs
```

The optional installed-Devin gate uses a disposable HOME, dummy MCP credentials,
and five role/instance launch directories. It proves real Skill, rule, symlink
and MCP discovery, then removes their dummy registrations and verifies all
five discover zero. Negative global-contamination checks remain enabled,
without model calls or foreign service invocation. Unit coverage also proves
dry-run, zero-MCP reprovisioning, shared asset preservation, and selective
credential/manifest rollback. This does not certify production startup/resume
or backend Principal permissions.

Storage is bounded to 256 managed files / 4 MiB, with Skill traversal capped at
1,024 entries and depth eight. No periodic scanner or separate session store is
introduced.

## Invariant Audit Surface

The managed-launch invariant covers workspace provisioning, normal start/run,
detached startup, profile switching, native resume, and hibernate/wake. Explicit
unmanaged launches remain outside this policy. Discovery uses schema/call-path
inspection, filesystem inventories, native CLI experiments, and runtime tests.

| Candidate | Classification | Action / Evidence |
| --- | --- | --- |
| Project/role/instance selectors | Managed input | Restricted identifiers; traversal tests |
| Destination roots and parents | Managed input | Absolute root and no symlink ancestors |
| Canonical role assets | Managed material | Digests, bounded traversal, no unapproved files |
| Instance instructions/Skills | Shared references | Only canonical role links permitted; real CLI symlink discovery |
| Credential files | Private material | Regular files, 0600, no credential links |
| Native/config-root arguments | Launch input | Supported arguments only; overrides refused |
| Foreground and inherited-terminal launch | Runtime entry | Managed cwd and native preflight in runCommand |
| Detached supervisor | Runtime entry | Same environment policy; existing runtime/receipt mechanism |
| Resume/profile switching | Runtime entry | Saved cwd checked; same workspace binding required |
| Wake generations | Runtime entry | Native preflight rerun before each spawn |
| Global/imported MCP and Skills | External discovery | Exact native inventory/source comparison; foreign fixtures rejected |
| Global/ancestor rules | External instructions | Exactly one canonical AGENTS source required |
| Existing unmanaged profiles | Explicit compatibility boundary | Original environment/lifecycle behavior retained |
| Live old controllers using global MCP | Deferred host cutover | No deletion/restart; see migration report |
| Account-uploaded PWA Skill | Deferred host cleanup | Backed up; canonical destination awaits Owner decision |
| Native auth and ordinary preferences | Protected user data | Preserved; host hashes checked unchanged |
| Shared Unix UID | Explicit security limitation | Discovery containment only; no secret-isolation claim |

No unexplained candidate in this bounded surface is treated as proof of global
cleanup or production authorization. The migration report records incomplete
acceptance separately from provisioner verification.
