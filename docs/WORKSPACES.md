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
Create new Workspace and Without workspace.

```text
? New Workspace selector (<project>.<agent>) > agentvm.lead
? Create Workspace agentvm.lead? > Yes
? Remember agentvm for this folder? > Yes
? Start devin in agentvm.lead? > Yes
```

No Role or instructions-file question follows. Creation scaffolds minimal
`AGENTS.md` and a small
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

Airelay creates only `AGENTS.md` and its binding manifest, never provider config.
The agent/user may add native CLI files. This is a manually configured Devin
example, not a mandatory or generated layout:

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
reprovisioning is required. The selected harness discovers its own native
configuration on launch/resume. Airelay does not inspect its MCP/Skills/rules. Changes do not promise that an already-running harness
reloads configuration; restart/resume according to that CLI's own rules.

Manual sharing of instruction/Skill assets may use links within the configured
Workspace root; escaping links, cycles and oversized trees are rejected. MCP
credentials should be protected by the operator. Airelay does not
interpret a folder, filename or instruction label as a Role or permission grant.
Do not edit identity fields to rebind a saved session silently.

## Filesystem Verification and Security

Workspaces support any profile, including arbitrary configured executables.
Profile args and environment work as on a normal launch. No provider-only flag
allowlist, native preflight commands, global Skill/AGENTS restrictions, or MCP
registration-count policy is imposed. Native configuration is opaque to
Airelay: imports, authentication and discovery belong to the harness/user.
Existing native files are not rewritten or removed during reprovisioning.

`workspace verify` reports `verification: "filesystem"`: it checks manifest,
paths, bounded file-tree safety and session binding, not authentication or
successful loading of instructions/tools. Optional `--profile` checks only
that the named Airelay profile exists. Use `airelay doctor <profile>` and the
harness's native diagnostics to inspect its installation/configuration.

Filesystem checks still reject traversal, escaping symlinks, cycles, excessive
trees and changed saved absolute bindings. A global-root change never redirects
an existing session. These checks run again on wake; they do not spawn native
inspection commands or parse provider configuration.

**A Workspace is not a sandbox or an environment/credential isolation boundary.**
Parent environment and explicit profile overrides are inherited normally.
Profile overrides apply to the harness, not Airelay's detached supervisor.
Global MCP/Skills/instructions may be discovered according to the native CLI.
A project may request zero MCP or particular Skills in its instructions, but
Airelay does not enforce those product-specific policies. Use real backend
credentials, authorization and OS-level isolation where required.

No daemon, identity, Job, credential, global registration or active process is
changed by Workspace provisioning/verification. Historical host cleanup is
separate from this launch contract; see the migration runbook.

## Audit and Verification

| Candidate | Classification | Action |
| --- | --- | --- |
| Selector/layout | One public meaning | Exactly project.agent -> project/agents/agent |
| Provisioner | Agent directory initializer | No Role schema, inheritance, asset import or digest freezing |
| Launcher | Project -> agent | No Role/instructions prompt and no root-setting action |
| Runtime/resume/detached | Existing session authority | Preserve saved absolute path; lock reservation against maintenance |
| Instructions/Skills | Agent/user-owned | Native harness owns content/discovery; Airelay checks bounded filesystem safety |
| MCP/auth/environment | Project-owned MCP policy | No preflight policy; use ordinary profile args/env and native configuration |
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
and demonstrates native discovery with local/global MCP, Skills and AGENTS
without an Airelay policy gate. It does not connect to MCP services.
Runtime fixtures cover two same-profile sessions, independent wake/restart,
root stability and detached transfer. These do not prove the real HOME is free
of global MCP registrations; host-wide MCP cutover is a separate operation.
