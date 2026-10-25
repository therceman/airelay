# Agent Workspaces

## Contract

Profile selects the installed harness/account. Workspace is the agent's working
folder. Session is one launch with its own `--key`. There is no Airelay Role,
Role assignment, inheritance or separate instance provisioning.

```bash
airelay start devin --key agentvm-lead --workspace agentvm.lead
airelay start devin --key agentvm-worker1 --workspace agentvm.worker1 --detached
airelay resume agentvm-worker1
```

The only public selector is `<project>.<agent>`: exactly two alphanumeric,
underscore/hyphen components, each 1-64 characters, starting alphanumeric.
Airelay inserts `agents` into the physical path:

```text
<workspaceRoot>/
  agentvm/
    agents/
      lead/
      worker1/
      worker2/
```

`agentvm.lead` means `<root>/agentvm/agents/lead`. There are no `.roles`,
`.instances`, or `.agents` selector variants. Traversal, symlinked Workspace
ancestors and unexpected manifest bindings are rejected.

Fresh installations use `~/.airelay/workspaces`; this installed host keeps
`/home/therceman/agent-workspaces`. Change the global root explicitly:

```bash
airelay config set settings.workspaceRoot /absolute/path/to/workspaces
```

The launcher only displays that setting. Existing sessions retain their saved
`{selector, root, path}` absolute binding across global-root changes, detached
supervision and wake. A session key cannot silently change its Workspace.
Old flat/version-1 paths are not automatically reinterpreted or redirected.

## Interactive Start

Run `airelay` from the source checkout, then choose Start and a normal profile.
The Workspace picker shows projects first, then their agents. It also offers
Create new Workspace, Back, and Without workspace.

```text
? New Workspace selector (<project>.<agent>) > agentvm.lead
? Create Workspace agentvm.lead? > Yes
? Remember agentvm for this folder? > Yes
? Start devin in agentvm.lead? > Yes
```

No Role or instructions-file question follows. Creation scaffolds minimal
`AGENTS.md`, empty `.devin/skills/`, empty public/private MCP files and a small
version-2 `.airelay-workspace.json` containing `{project, agent}` and optional
source checkout. It does not copy source repositories or create profiles.
Creation is atomic and idempotent; existing unmanaged files are never overwritten.

Optional confirmation remembers the canonical source folder -> project in
`settings.workspaceProjects`. The longest explicit ancestor wins, never a
sibling prefix. It opens the project branch, not a preselected agent. Hints are
scoped to their saved storage root, bounded to 128 sources, and never override
an existing session binding. Clear with:

```bash
airelay config set settings.workspaceProjects '[]'
```

## CLI Provisioning

```bash
airelay workspace provision agentvm.lead --source /existing/source/checkout --dry-run
airelay workspace provision agentvm.lead --source /existing/source/checkout
airelay workspace list --json
airelay workspace inspect agentvm.lead --json
airelay workspace verify agentvm.lead --profile devin --json
```

`--dry-run` / `-n` writes nothing. Repeated provisioning leaves user files alone.
There are no Role/Skills import, permission-principal or `--update` flags.
Profile-bound Workspace configuration and generated Workspace profiles are not
supported. Use a normal profile plus the session `--workspace` parameter.

## Agent/User Customization Guide

Airelay provides the directory; the agent/user maintains its native CLI files:

```text
agentvm/agents/lead/
  AGENTS.md
  .devin/
    skills/
      repository-guide/
        SKILL.md
    mcp_config.json          # {"mcpServers":{}}
    mcp_config.local.json    # {"mcpServers":{}}, regular file, mode 0600
  .airelay-workspace.json    # identity/path binding; not instructions
```

Example `AGENTS.md`:

```markdown
# Project guidance
Source checkout: /home/user/git/agentvm
Read that checkout's AGENTS.md before editing. Run its documented tests.
```

Example `.devin/skills/repository-guide/SKILL.md`:

```markdown
---
name: repository-guide
description: How to work in this source repository.
---
Use /home/user/git/agentvm. Follow its build and review instructions.
```

Edit/add instructions and Skills directly: no digest registration or
reprovisioning is required. Native CLI discovery is checked again on each
managed launch/wake. Changes do not promise that an already-running harness
reloads configuration; restart/resume according to that CLI's own rules.

Manual sharing of instruction/Skill assets may use links within the configured
Workspace root; escaping links, cycles and oversized trees are rejected. MCP
configuration files must never be credential symlinks. Airelay does not
interpret a folder, filename or instruction label as a Role or permission grant.
Do not edit identity fields to rebind a saved session silently.

## Native Verification and Security

Managed verification currently supports native Devin only. Unsupported harnesses
fail closed rather than claiming verification. Without `--workspace`, normal
profile cwd/env/lifecycle behavior remains unchanged.

**Current policy is zero MCP.** Both local MCP files must be empty, and actual
native `devin mcp list` must report zero registrations, including global/imported
configuration. Local instructions and discovered Skills must match this agent's
current files; product built-ins are allowed, foreign global resources are not.
Additional `.devin/config*.json` imports are rejected. Native checks share a
10-second budget with bounded output; secret-bearing failure output is not echoed.

Managed launches use the existing environment allowlist and real HOME/native
login, not an XDG overlay. Parent credentials are not re-merged at the PTY boundary.
Selecting a Workspace does not authorize tools. Same-UID shells can still read
one another's files; use real backend authorization for security boundaries.
No MCP daemon, identity, Job, credential or global registration is removed by
Workspace provisioning. Removing unused generated folders is a separately
approved host maintenance action, recorded in the migration runbook.

## Future BB-MCP Reconnection (Not Implemented or Approved)

The future target remains one HTTP daemon/endpoint and local alias `bb-mcp`,
with a unique header Bearer credential per authorized agent. Server-side
authentication owns immutable identity, backend role and entitlements; never
authorize by alias, directory, session key or a client role query parameter.
Never place credentials in URLs. No global/unrelated-project registration or
automatic reconnection is introduced by the agent-only Workspace layout.

## Audit and Verification

| Candidate | Classification | Action |
| --- | --- | --- |
| Selector/layout | One public meaning | Exactly project.agent -> project/agents/agent |
| Provisioner | Agent directory initializer | No Role schema, inheritance, asset import or digest freezing |
| Launcher | Project -> agent | No Role/instructions prompt and no root-setting action |
| Runtime/resume/detached | Existing session authority | Preserve saved absolute path; lock reservation against maintenance |
| Instructions/Skills | Agent/user-owned | Validate current bounded filesystem state and native discovery |
| MCP/auth/environment | Preserved safety policy | Zero MCP; native login and existing managed env filtering |
| Version-1 layout | Explicit hard cut | Reject; approved unused generated host folders backed up/removed |
| Profile-bound Workspace | Unsupported | Reject without rewriting user configuration |
| Unmanaged profiles | Compatibility contract | Keep normal launch behavior |
| Historical runbook / application role terminology | Not a live Airelay feature | Keep factual history; do not restore Role APIs |

```bash
npm test -- --runInBand workspace workspace-session workspace-select
npm run build
node scripts/verify-workspace-devin.cjs
```

The native script uses disposable HOME/Workspaces, makes no model/service calls,
and verifies edits without reprovisioning plus foreign-resource rejection.
Runtime fixtures cover two same-profile sessions, independent wake/restart,
root stability and detached transfer. These do not prove the real HOME is free
of global MCP registrations; host-wide MCP cutover is a separate operation.
