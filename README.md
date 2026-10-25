# Airelay

**A terminal-based session manager for AI coding agents.**

Airelay manages Codex, Devin, and OpenCode **through their existing terminal interfaces**. It began as a fast way to switch between accounts (such as Codex A and Codex B) and resume work in the same project; it grew into a local experimental control layer for agent sessions, terminal-to-terminal messaging, and resource-aware background execution.

Airelay is a cross-platform CLI for Windows, macOS, and Linux. It uses PTYs and local IPC instead of ACP, MCP, or provider app-server APIs to communicate with managed harnesses. It does **not** implement its own AI agent, autonomous task planner, or remote control plane.

> **Why Airelay?** Reuse your native agent CLIs, rapidly switch profiles, navigate saved sessions across projects, let agents message other agents' terminals, and hibernate idle harnesses to release memory.

## What Airelay does

- **Multiple accounts and isolated profiles.** Configure separate environments for Codex, Devin, or OpenCode. Switch profiles when resuming a saved session of the **same harness**, subject to that harness's native authentication and session rules.
- **Cross-agent messaging through terminals.** A command running inside one managed agent session can call `airelay prompt` to send text to another session. Airelay delivers input to the destination's PTY via local IPC; it does not require ACP, MCP, or a provider app-server API.
- **Detached sessions and terminal attach.** Run a supervised agent session in the background, then attach to its existing PTY without starting another harness instance.
- **Session identity for tools.** Each managed harness receives `AIRELAY_SESSION_KEY` and other session metadata in its environment. Tools launched by the agent can use this context to identify the calling session and select project- or role-specific behavior.
- **Project and session navigation.** Start, list, attach to, monitor, and resume agent sessions across project directories.
- **Automatic hibernation.** For eligible, resumable sessions, an idle harness process can be stopped to release memory while Airelay retains enough session information to wake it through its native resume mechanism.
- **Native harness experience.** Continue using the original Codex, Devin, and OpenCode terminal UIs and their provider-specific features.

### Supported harnesses

| Harness | Launch through Airelay | Native resume integration | Notes |
| --- | --- | --- | --- |
| **Codex CLI** | Yes | `resume <session-id>` | Supports separate Codex profiles and explicit permission bypass |
| **Devin CLI** | Yes | `--resume <session-id>` | Supports Devin-specific readiness, submission, and permission behavior |
| **OpenCode** | Yes | `-s <session-id>` | Supports profile configuration and native sessions |

Airelay also accepts a configurable executable, but unknown harnesses do not have the same provider-specific terminal integration. Platform compatibility depends on the installed CLI tools and their terminal behavior.

## Quick start

Requirements: Node.js 18+ and at least one supported coding-agent CLI installed and authenticated separately.

```bash
npm install -g airelay

airelay init
# Or create explicitly named profiles:
airelay create codex-personal --executable codex
airelay create devin-work --executable devin
airelay create opencode-work --executable opencode

airelay list
airelay start codex-personal
```

Run `airelay guide` for an environment-specific setup walkthrough, or `airelay doctor` to check detected tools.

## 1. Switch accounts without starting over

Airelay began as a way to work across multiple accounts of the same coding harness — for example, `codex-a` and `codex-b` — and resume the same project without manually reconstructing its command line and session history.

```bash
airelay create codex-a --executable codex
airelay create codex-b --executable codex

airelay start codex-a
# Work normally in Codex. Save/identify its native session.
# Exit the session, then:
airelay resume
```

In the interactive resume flow, choose **Use another profile (same harness)** and select `codex-b`.

Airelay reuses the recorded project and native session arguments while changing the selected profile. Each profile can have its own authentication/configuration overlay. **Account switching does not override the provider's own session ownership or authentication rules**; cross-account resume must be supported by the underlying harness.

The account-switching UI is intentionally restricted to profiles of the **same harness** (Codex to Codex, not Codex to Devin).

## 2. Send messages between agent terminals

Suppose one terminal is running Codex and another is running Devin. Start two Airelay-managed sessions with explicit keys:

```bash
# Terminal A
airelay start codex-personal --key planner --detached

# Terminal B
airelay start devin-work --key reviewer --detached
```

From a third terminal — or **from a shell command executed by an agent inside the `planner` session** — send a message to the other agent:

```bash
airelay prompt reviewer "Review the changes and report any issues."
```

The route is:

```text
Agent / shell command
  -> airelay prompt <session-key>
  -> local Airelay controller (Unix socket / Windows named pipe)
  -> destination pseudo-terminal (PTY)
  -> destination agent's native CLI interface
```

When the caller runs *inside* an Airelay-managed session, Airelay exposes `AIRELAY_SESSION_KEY` and automatically prefixes the outgoing message with `[from=<sender-session-key>]`, unless sender attribution is disabled. For example, when `planner` sends the prompt above, the destination sees text like:

```text
[from=planner] Review the changes and report any issues.
```

The receiving harness still processes the input through its own terminal UI; Airelay is a transport, not a task-completion protocol. You can inspect running sessions and their state with:

```bash
airelay sessions --active
airelay session-status reviewer
airelay attach reviewer       # Detach the viewer with Ctrl-D
```

This is **terminal-mediated messaging**, not a native agent-to-agent protocol. A successful `airelay prompt` means the controller accepted the delivery; it does **not** guarantee the target agent completed the requested work. Airelay does not independently provide task planning, authorization policies, code review, or verified autonomous orchestration.

## 3. Session identity and context-aware tools

Airelay injects session metadata into the environment of every managed harness. A CLI launched by the agent can inspect these variables to determine **which Airelay session invoked it**, without asking the agent to pass its identity manually.

| Variable | Meaning |
| --- | --- |
| `AIRELAY_SESSION_KEY` | Human-usable session key, e.g. `planner` |
| `AIRELAY_PROFILE` | Selected harness/account profile |
| `AIRELAY_RUNTIME_ID` | Runtime instance identifier |
| `AIRELAY_CWD` | Working directory for the managed session |
| `AIRELAY_NATIVE_SESSION_ID` | Native harness session ID, when known |

For example, a project-specific CLI can read `AIRELAY_SESSION_KEY` and select the corresponding project/agent context or role-specific interface. This pattern was used experimentally in early RepoSuite/Gateway workflows: the calling agent's environment supplied the session context, while the application using that context implemented its own routing rules.

```bash
# Run inside an Airelay-managed agent's shell:
printf '%s\n' "$AIRELAY_SESSION_KEY"

# Send a message to another local agent session:
airelay prompt reviewer "Check the current task and report your findings."
```

**Security boundary:** these are process environment variables, not authenticated identities or permission grants. Context-aware CLIs must validate authorization independently; agents and tools should not treat an environment-supplied session key as proof of authority.

## 4. Resume, detach, and hibernate

Airelay can save launch history and resume a supported harness's native session. Detached runtimes let the session controller continue without keeping the original launcher terminal attached:

```bash
airelay start codex-personal --key work-agent --detached
airelay sessions --active
airelay attach work-agent
airelay session-status work-agent --json
```

**Automatic hibernation** is a resource-saving feature for *eligible resumable sessions*. When the configured idle period elapses, Airelay can terminate the underlying harness process while keeping its controller/session metadata. On wake, it starts the harness again with its saved native session ID.

The current default is **30 minutes** (not five):

```bash
airelay config set settings.hibernateAfter 10m
# To disable hibernation:
airelay config set settings.hibernateAfter off
```

Hibernation requires a known native session ID, an idle session, and **no attached viewport clients**. Newly started sessions without a safely saved native ID are not hibernated. The amount of memory released depends on the harness and workload; Airelay cannot reduce the intrinsic runtime cost of the harness TUI itself.

## Configuration

Configuration is stored in `~/.airelay/config.yaml` by default (override with `AIRELAY_CONFIG`). Profiles specify an executable, working directory, optional arguments, and optional isolated environment variables.

```yaml
version: 1
settings:
  promptMaxLength: -1
  hibernateAfter: 30m
  harnessSelfUpdate: false

profiles:
  codex-a:
    executable: codex
    cwd: ~/git/project-a
    env:
      CODEX_HOME: ~/.codex-a
  codex-b:
    executable: codex
    cwd: ~/git/project-a
    env:
      CODEX_HOME: ~/.codex-b
  devin-work:
    executable: devin
    cwd: ~/git/project-b
```

Use `airelay create <name> --executable <tool>` for guided profile creation, and `airelay config list` or `airelay which <profile>` to inspect settings. Harness authentication remains the responsibility of the installed CLI.

## Project and agent workspaces

Workspace is an independent **session parameter**, not a generated profile:

```bash
airelay start devin --key rsg-lead --workspace rsg.lead
airelay start devin --key bb-worker-01 --workspace bb_splunk.worker1 --detached
airelay resume bb-worker-01
```

One profile can run multiple Workspaces concurrently. Select a Workspace in the
interactive **Start** launcher, or use `--workspace` (`-w`). Saved sessions keep
their resolved directory even if `settings.workspaceRoot` changes. Fresh roots
default to `~/.airelay/workspaces`; existing configured roots are preserved.
The launcher selects a project, then an agent, or creates one with a simple
`<project>.<agent>` selector. For example, `agentvm.lead` maps to
`<workspaceRoot>/agentvm/agents/lead`. The storage root is a global config setting,
not a launcher action. Optionally remember the source folder's project association.

Airelay does not create or assign Roles. Agents/users maintain their own
`AGENTS.md`, Skills and native MCP configuration; edits do not require
reprovisioning. Workspaces work with any profile using its normal args/env.
Airelay verifies filesystem paths and the session binding, not native tool
discovery, global instructions or MCP policy. A Workspace is not a sandbox.
See [Agent Workspaces](docs/WORKSPACES.md) for the layout and security limits.
Launching without `--workspace` keeps ordinary profile behavior.

## Command reference

| Command | Purpose |
| --- | --- |
| `airelay init` / `airelay guide` | Set up and discover installed harnesses |
| `airelay create <name> --executable <tool>` | Create a profile |
| `airelay start <profile> [--key <key>] [--workspace <selector>] [--detached]` | Launch a PTY-backed managed session |
| `airelay resume [key]` | Resume session history / select a matching profile |
| `airelay sessions [--active] [--json]` | Inspect saved and active sessions |
| `airelay session-status <session> [--json]` | Inspect controller and activity status |
| `airelay prompt <session> "text"` | Deliver input to another managed session |
| `airelay attach <session>` | Attach to an existing detached runtime |
| `airelay list` / `airelay which <profile>` | List or inspect profiles |
| `airelay doctor [profile]` | Check configured runtimes |
| `airelay workspace provision` / `inspect` / `verify` | Manage project/agent workspaces |
| `airelay run <profile> -- <args>` | Execute with inherited terminal (not promptable) |
| `airelay config list` / `set` / `unset` | Inspect and change configuration |

Run `airelay help` for the full CLI, including diagnostics, session output, interrupts, and advanced flags.

### Security and limitations

- `airelay start --bypass` is **explicit and high risk**: for supported harnesses it disables or bypasses provider permission safeguards; it is never the default. Use only in trusted environments.
- Controllers communicate locally (Unix sockets on macOS/Linux and named pipes on Windows). Airelay itself is not a remote-access SaaS or an internet-facing agent gateway.
- Terminal integration depends on each harness's changing TUI and native resume behavior. Some readiness or input workflows may require updates when a provider changes its CLI.
- The sender prefix provides useful context; it is not a cryptographically authenticated agent identity or authorization boundary.
- Prompt delivery is not proof of completion, and switching profiles does not merge accounts or provider session histories.

## How it works

```text
          Local machine (Windows, macOS, Linux)

  Codex agent in session "planner"
       | runs a shell command
       v
  airelay prompt reviewer "Review the changes"
       | local IPC request
       v
  Airelay controller for "reviewer"
       | injects text into its managed PTY
       v
  Devin native CLI / terminal UI
       v
  Devin agent receives the prompt

  (Each managed session has its own controller and PTY.)
```

Airelay owns the local session lifecycle and terminal transport; the actual agent executes within its existing harness. Detached sessions keep the controller and PTY running without the original foreground terminal, while `airelay attach` connects a viewport client to the existing runtime. Hibernation can stop an idle, resumable harness process and relaunch it on demand; it does not preserve a running process in memory.

For implementation detail, see [Code Map](docs/CODE-MAP.md), [Domain Model](docs/DOMAIN.md), and [Session Management ADR](docs/adr/001-session-management.md).

## Origin and evolution toward RepoSuite

Airelay has been an engineering testbed for several ideas that eventually informed **RepoSuite**:

1. **Account switching.** Its original purpose was rapid profile/account switching, such as Codex A to Codex B, while keeping a project and its native session history available for resume.
2. **Agent communication.** Airelay added terminal-to-terminal message delivery so an agent in one harness could prompt an agent in another, without requiring ACP, MCP, or a provider-specific app-server.
3. **Context-aware tooling.** Injected session environment variables allowed project tools to recognize the calling session and experimentally resolve agent/role-specific context.
4. **Background sessions and memory management.** Detached execution, re-attach, native resume, and idle hibernation made it practical to manage more agent sessions without keeping every TUI process resident.
5. **Gateway experimentation.** Earlier RepoSuite/Gateway workflows used Airelay as a local delivery mechanism for messages to terminal-based coding agents. This helped test delegation and orchestration concepts, but highlighted the fragility of depending on interactive CLIs as a control interface.

**Why a separate Relay?** Terminal integration inherits the latency, memory overhead, terminal state, and compatibility quirks of the underlying TUI. Airelay can manage these constraints, but cannot fundamentally remove them. RepoSuite is a separate cloud–local development platform whose Relay component is designed to move toward more direct, structured runtime integrations and a stronger lifecycle/control model.

Airelay remains a standalone open-source CLI, **not** RepoSuite Relay. The connection is architectural history, not a claim that Airelay itself provides RepoSuite's cloud control, authorization, or autonomous workflow capabilities.

## Development

```bash
npm install
npm run build
npm test
npm run lint
npm run format:check
```

Run `npm run verify` for the repository's full configured checks (including dependency audit).

## License

MIT
