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
    instances/worker-01/            optional, separate MCP identity
    instances/worker-02/            optional, separate MCP identity
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
set, including any MCP configuration that must remain configured.

Each role owns one regular `AGENTS.md` and one copy of each Skill. Optional
instances link only those assets to the canonical role. MCP credentials are
copied into regular mode-0600 `.devin/mcp_config.local.json` files, never linked.
The public `.devin/mcp_config.json` is an empty base configuration. Omit
`--mcp-config` for zero approved MCP servers.

```bash
airelay workspace provision bb_splunk worker \
  --instructions /path/to/worker/AGENTS.md --skills-dir /path/to/worker/skills

airelay workspace provision bb_splunk worker --instance worker-01 \
  --mcp-config /private/worker-a.json --principal worker-a
airelay workspace provision bb_splunk worker --instance worker-02 \
  --mcp-config /private/worker-b.json --principal worker-b
```

The MCP input must have the shape `{"mcpServers": {...}}` supported by the
installed CLI. Keep secret-bearing inputs outside Git with restrictive
permissions. `--principal` is an optional nonsecret operator label, not a
credential or authorization grant. Provisioning never creates a backend
Principal, account or lab entitlement.

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

Before removing global resources, inventory every source/import and active
consumer, save private backups outside active configuration directories, and
verify local replacements with the installed CLI. Do not remove built-ins,
provider authentication, ordinary preferences, daemons or live session state.
Wait for safe cutover if a running controller would wake into the old directory.

`src/workspace/backup.ts` records original paths, modes, ownership and hashes.
`restoreWorkspaceConfiguration(backupDirectory, [reviewedOriginalPaths])`
restores only selected files after validating backup hashes. Restore only files
changed by the migration; do not overwrite independently refreshed provider
authentication/preferences. Retain backups and any user-edited workspace files.

The host preparation status and outstanding cutover decisions are recorded in
[the migration report](WORKSPACE-MIGRATION-2026-10-23.md).

## Verification

```bash
npm test -- --runInBand test/workspace.test.ts
npm run build
node scripts/verify-workspace-devin.cjs
```

The optional installed-Devin gate uses a disposable HOME, dummy MCP credentials,
and five role/instance launch directories. It proves real Skill, rule, symlink
and MCP discovery plus negative global-contamination checks, without model
calls or foreign service invocation. It does not certify production agent
startup/resume or backend Principal permissions.

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
