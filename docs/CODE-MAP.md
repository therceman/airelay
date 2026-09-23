# Airelay Code Map

Use this as a navigation index, not as a second behavioral specification. Source,
tests, `AGENTS.md`, and `GATES.md` are authoritative. When a detail here conflicts
with current code, follow the code and update this map if the ownership structure
has materially changed.

## Start Here

| If you need to understand…                  | Start with                                            | Then inspect                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI entry, aliases, argument dispatch       | `src/index.ts`, `src/cli.ts`                          | `test/cli-runCli.test.ts`, `test/cli-integration.test.ts`                                                                                                                                       |
| Interactive menu and resume choices         | `src/commands/select.ts`                              | `src/commands/resume.ts`, `src/commands/start.ts`, `test/select.test.ts`, `test/resume.test.ts`                                                                                                 |
| A harness process/session lifecycle         | `src/commands/run.ts`                                 | `src/runtime/spawn.ts`, `src/runtime/pty.ts`, `test/run.test.ts`, `test/hibernate.test.ts`                                                                                                      |
| Controller, terminal state, or IPC          | `src/controller/index.ts`                             | `src/controller/protocol.ts`, `src/types/controller.ts`, `test/controller-*.test.ts`                                                                                                            |
| Resume hydration/reveal or terminal queries | `src/runtime/resume-presentation.ts`                  | `src/runtime/terminal-query.ts`, `src/controller/index.ts`, `test/resume-presentation.test.ts`, `test/terminal-query.test.ts`                                                                   |
| Prompt submission and retries               | `src/runtime/delivery-sequence.ts`                    | `src/runtime/input-submit-watcher.ts`, `src/runtime/delivery-marker.ts`, `src/commands/run.ts`, `test/delivery-sequence.test.ts`, `test/input-submit-watcher.test.ts`, `test/run-input.test.ts` |
| Busy/idle reasoning                         | `src/runtime/activity.ts`                             | `src/commands/run.ts`, `src/types/controller.ts`, `test/activity.test.ts`, `test/session-status-blocking.test.ts`                                                                               |
| Harness-specific arguments/capabilities     | `src/utils/harness.ts`                                | `src/commands/run.ts`, `test/harness.test.ts`, `test/workspace-trust.test.ts`                                                                                                                   |
| Config parsing/defaults/paths               | `src/config/schema.ts`                                | `src/config/load.ts`, `src/config/paths.ts`, `src/config/defaults.ts`, `test/config.test.ts`, `test/paths.test.ts`                                                                              |
| Detached runtime start/list/stop            | `src/commands/detached.ts`                            | `src/runtime/detached-registry.ts`, `src/commands/stop.ts`, `src/commands/attach.ts`, `test/detached.test.ts`, `test/stop.test.ts`, `test/attach.test.ts`                                       |
| Session history and saved IDs/keys          | `src/commands/sessions.ts`, `src/commands/history.ts` | `src/commands/resume.ts`, `src/commands/select.ts`, `test/sessions.test.ts`, `test/history.test.ts`                                                                                             |

## Dependency Shape

```text
src/index.ts
  └─ src/cli.ts                         command parsing and lazy dispatch
       ├─ commands/*                    short-lived command handlers and TUI
       └─ commands/run.ts               long-lived runtime composition root
            ├─ runtime/spawn.ts ── runtime/pty.ts ── node-pty
            ├─ controller/index.ts ── @xterm/headless
            │                       └─ @xterm/addon-serialize
            ├─ runtime/*                 activity, delivery, hibernate, diagnostics,
            │                            resume presentation, capacity, signals
            ├─ utils/harness.ts           harness capabilities and argument policy
            └─ config + session stores    profile/config and launch/session state

controller IPC clients
  ├─ commands/attach.ts ── controller protocol/socket
  ├─ commands/prompt.ts ── controller protocol/socket
  ├─ commands/session-*.ts ── controller protocol/socket
  └─ commands/stop.ts ── detached registry + controller protocol/socket
```

The production dependency list is in `package.json`. The main runtime boundary
packages are `node-pty` (PTY), `@xterm/headless` (terminal model),
`@xterm/addon-serialize` (replayable current presentation), `yaml` (config),
`zod` (validation), and `enquirer` (interactive prompts). Avoid adding another
terminal parser or serializer without first checking the controller/xterm APIs.

## Ownership Map

### CLI and Commands

- `src/cli.ts` owns top-level command/alias dispatch. Implementations are loaded
  per branch; preserve this lazy-loading boundary when adding commands.
- `src/commands/select.ts` owns the interactive menu and choice orchestration.
  Resume/start mechanics belong in their dedicated command modules, not in the
  CLI dispatcher.
- `src/commands/run.ts` is the runtime composition root. It wires the profile,
  PTY, controller, lifecycle state, activity, delivery, hibernation, diagnostics,
  and foreground presentation. Keep policy in the focused runtime/controller
  owner; use `run.ts` to connect those owners.
- Other `src/commands/*.ts` files generally own one user-facing command. IPC
  client helpers are grouped in `session-ipc.ts`; `session-status.ts`,
  `session-viewport.ts`, `session-scrollback.ts`, `session-output.ts`,
  `session-find.ts`, and `session-debug.ts` are distinct read/diagnostic
  surfaces.

### Runtime

- `pty.ts`: PTY creation, input/output forwarding, external resize coordination,
  exit/cleanup. It is the low-level process/terminal boundary.
- `resume-presentation.ts`: foreground hydration suppression, query side-channel,
  reveal readiness, snapshot cutover, and post-cutoff ordering. It delegates the
  materialized terminal snapshot to `SessionController`.
- `terminal-query.ts`: bounded recognition/classification of approved terminal
  queries and replies; do not broaden the whitelist without evidence/tests.
- `delivery-sequence.ts`, `delivery-marker.ts`, and
  `input-submit-watcher.ts`: command-driven body/marker/submit ordering, marker
  state, and bounded Enter-only retries. Keep manual/raw input separate.
- `delivery.ts`: delivery status/correlation. `post-submit-working.ts` detects
  supported post-submit working evidence; it is not the activity clock.
- `activity.ts`: I/O timestamps and the 5-second recent-I/O rule. The runtime
  combines this with an unresolved prompt lease and the harness-working guard.
- `capacity-watcher.ts`, `interrupt.ts`, `harness-ready.ts`, and
  `mouse-filter.ts`: focused runtime policies; edit these rather than adding
  parallel policies to the orchestrator.
- `diagnostics.ts`: bounded metadata-only PTY/resume trace. It must not persist
  prompts, PTY output, environment values, or terminal contents.
- `detached-registry.ts`, `identity.ts`, `signals.ts`, and `procfs.ts`: detached
  process metadata, runtime identity, signal forwarding, and Linux process
  inspection respectively.

### Controller and Protocol

- `src/controller/index.ts` owns the Unix socket server, request dispatch,
  headless xterm, SerializeAddon, terminal buffers, presentation reset/snapshot,
  transcript snapshots, and live runtime/memory/buffer information.
- `src/controller/protocol.ts` owns framing, request parsing, and response/frame
  serialization. `src/types/controller.ts` owns typed IPC payloads and public
  session-info structures.
- For a new IPC method, update the method/type definitions, controller dispatch,
  client call site, focused tests, and protocol compatibility policy together.
  Check `src/utils/version.ts` for `CONTROLLER_PROTOCOL_VERSION`; do not assume
  an old long-lived controller is compatible with a new CLI.
- The controller's headless xterm is the terminal-state authority. Do not infer
  its active buffer, viewport, or serialized presentation from a duplicate
  application-level parser.

### Configuration, Harnesses, and State

- `src/config/schema.ts` defines accepted config shape; `load.ts`, `paths.ts`,
  and `defaults.ts` own loading, canonical paths, and defaults.
- `src/utils/harness.ts` owns harness-specific capabilities, resume arguments,
  bypass transformations, ready/trust detection, and session patterns.
  `detect-harnesses.ts` is for executable discovery, not policy duplication.
- `src/utils/harness-isolate.ts` and `harness-isolation.ts` own isolated harness
  home setup/repair/removal. Preserve the distinction between shared native
  homes and explicit isolated profiles.
- `src/utils/json-store.ts` is the small JSON persistence primitive. Domain
  stores select their own path and schema: session/history and PID state live in
  command/utility modules; detached runtime state is in `runtime/detached-registry.ts`.
- `src/utils/ipc-path.ts` and `src/utils/unix-socket.ts` own endpoint naming and
  socket ownership/probing. `src/utils/transcript.ts` owns transcript persistence
  helpers; controller live buffers are not durable transcript storage.

## Main Runtime Flows

### Foreground Start or Resume

```text
CLI → start/resume/select → runCommand
    → resolve profile, cwd, env, harness args/capabilities
    → create SessionController and establish its socket
    → create PTY at current size
    → route every PTY chunk into controller/headless xterm
    → for resumable foreground generations, gate visual hydration
    → serialize current controller presentation at reveal
    → switch to normal live foreground passthrough
    → finalize runtime/session state on exit
```

The resume presentation gate suppresses foreground painting, not controller
ingestion. It has quiet/max cutover and bounded post-cutoff ordering; do not
replay suppressed hydration. Read its tests before changing reveal semantics.

### Command-Driven Prompt

```text
airelay prompt → session IPC → run.ts input handler
    → validate caller prompt
    → one body write → separate local-time marker write → submit key
    → watcher observes rendered/controller state and may retry Enter only
    → delivery status and prompt lease resolve independently of activity quiet time
```

Raw/manual input and `enter:false` have separate contracts: they must not gain a
delivery marker or automatic submit behavior. See the delivery-sequence and
run-input tests before changing the input path.

### Detached, Attach, Stop

```text
airelay start --detached → detached runtime process → PTY + controller socket
airelay attach <key>     → attach client streams controller frames/input/resize
airelay stop <key>       → resolve detached entry → request runtime/controller stop
```

The detached registry identifies runtimes; a session key may have multiple
historical entries, so inspect the deterministic lookup policy before changing
selection or stop behavior. `attach` is a client, not another harness runtime.

### Hibernate and Wake

The controller/runtime intentionally survives hibernation while the harness PTY
generation is absent. Hibernate and final shutdown are distinct paths. The
live presentation reset establishes a clean generation boundary; it does not
delete durable transcript/history. Inspect `run.ts`, controller presentation
reset code, and `test/hibernate.test.ts` before changing lifecycle behavior.

## Change-to-Test Map

| Change                               | Focused tests to run first                                                                                 | Broader verification                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| CLI command/alias/menu               | `test/cli*.test.ts`, `test/select.test.ts`                                                                 | `npm test`                                                            |
| Harness args, bypass, trust, resume  | `test/harness.test.ts`, `test/workspace-trust.test.ts`, `test/resume.test.ts`, `test/start.test.ts`        | `test/cli-integration.test.ts`                                        |
| PTY spawn, input, resize, signals    | `test/spawn.test.ts`, `test/run-input.test.ts`, `test/signals.test.ts`                                     | `test/run.test.ts`, `test/detached.test.ts`                           |
| Resume presentation/query extraction | `test/resume-presentation.test.ts`, `test/terminal-query.test.ts`                                          | `test/controller-presentation.test.ts`, `test/controller-e2e.test.ts` |
| Controller IPC/socket/session info   | `test/controller-protocol.test.ts`, `test/controller-ipc-path.test.ts`, `test/unix-socket.test.ts`         | `test/controller-e2e.test.ts`, relevant `session-*.test.ts`           |
| Prompt delivery/retry/status         | `test/delivery-sequence.test.ts`, `test/delivery-marker.test.ts`, `test/input-submit-watcher.test.ts`      | `test/run-input.test.ts`, `test/prompt.test.ts`                       |
| Activity/hibernate/wake              | `test/activity.test.ts`, `test/hibernate.test.ts`                                                          | `test/run.test.ts`, `test/session-status-blocking.test.ts`            |
| Config and profile isolation         | `test/config.test.ts`, `test/config-command.test.ts`, `test/paths.test.ts`, `test/harness-isolate.test.ts` | `test/init.test.ts`                                                   |
| Detached registry/attach/stop        | `test/detached.test.ts`, `test/attach.test.ts`, `test/stop.test.ts`                                        | `test/controller-e2e.test.ts`                                         |
| Diagnostic trace/status              | `test/runtime-diagnostics.test.ts`, `test/session-status-blocking.test.ts`                                 | `test/status.test.ts`                                                 |

Use `test/utils.ts` and `test/TEST-UTILS.md` for test isolation. Never point
tests at the real `~/.airelay` state.

## Contracts Worth Preserving

- A live controller with no harness PID can be a healthy hibernated session;
  absence of a harness alone is not an orphan condition.
- Runtime identity distinguishes controller PID, harness PID, runtime ID, and
  lifecycle state. Do not overload a generic PID field.
- Unix socket cleanup is ownership-sensitive. Never unlink a reachable or
  ambiguously owned socket to make startup succeed.
- `SessionController.stop()` and PTY/runtime cleanup are lifecycle boundaries;
  timers, sockets, clients, terminal state, and owned files must be handled on
  the correct hibernate-versus-final-stop path.
- Activity reasons are intentionally small: `prompt_delivery`,
  `harness_working`, `recent_io`, `idle`; recent PTY input/output quiet threshold
  is 5 seconds. Delivery completion is not itself the activity clock.
- Resume hydration is never replayed as raw output. The controller's official
  SerializeAddon snapshot is the presentation source at cutover.
- Controller IPC protocol changes must be coordinated with long-lived runtime
  compatibility and protocol-version tests.
- Diagnostics are bounded metadata only; never add prompts or PTY content.

## Verification and Release

`AGENTS.md` lists the normal scripts; `GATES.md` is the canonical 20-gate
completion contract. For a code change, use focused tests first and then the
repository verification scripts. Tests must remain isolated from user state.
Version changes are deliberate release changes, not a side effect of building.

## Refreshing This Map

Update this document when ownership or major runtime flow changes. Do not try to
catalog every helper or freeze every CLI detail here. Keep the map bounded and
link to source/tests rather than copying implementation. Before adding a new
major subsystem, decide which existing owner it belongs to and add one row to
the ownership and change-to-test maps.
