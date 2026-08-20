# Task 078: Add detached runtime registry and attach client

## ID
`task_078_add_detached_runtime_registry_and_attach`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/cli.ts`
- `src/commands/start.ts`
- `src/commands/run.ts`
- `src/commands/attach.ts`
- `src/commands/detached.ts`
- `src/controller/index.ts`
- `src/runtime/spawn.ts`
- `src/runtime/pty.ts`
- `src/runtime/*` canonical process/registry utilities as required by audit
- `src/types/controller.ts`
- `src/types/*` as required by audit
- `test/` focused CLI/controller/runtime tests
- `tasks/todo/task_078_add_detached_runtime_registry_and_attach_report_draft.md`
- `tasks/todo/task_078_add_detached_runtime_registry_and_attach_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Add supervised detached runtimes with non-blocking attach

## Scope
- Start from clean pushed master `feaaece`, Airelay `0.1.67`.
- Preserve the current interactive behavior exactly for ordinary:
  - `airelay start <profile> [--key <key>] -- <harness_args...>`
  - It must continue using the current direct PTY/stdin path. Do not route this path through viewport polling or IPC raw-input forwarding. Existing terminal input latency and resize behavior must not regress.
- Add an explicit `--detached` start mode. It must launch a separate supervised Airelay runtime/controller process that owns the PTY and agent, return without inheriting terminal stdin/stdout, and continue running after the launcher/client exits. Do not add a `--no-attach` alias.
- Add `airelay attach <session>` for a detached runtime. Attach must:
  - resolve the existing runtime/session without starting a second agent or PTY;
  - render live viewport updates at a bounded 200 ms interval (5 updates per second maximum);
  - forward raw terminal input and resize immediately through dedicated IPC operations, not through the viewport polling loop and not through `session.input` text-to-Enter delay;
  - disconnect on `Ctrl-D` or client terminal close without stopping the runtime;
  - provide the existing safe high-level controls (`prompt`, `interrupt`) through the canonical controller path;
  - never send an extra Enter or duplicate prompt text merely because a viewport poll runs.
- Keep the ordinary prompt path unchanged: `airelay prompt <session> ...` still routes directly to the persistent controller and keeps its existing delivery ID, Enter delay, watcher, and retry behavior.
- Add an `airelay detached` registry command. Pick this exact command name, not multiple aliases. It must list active detached runtimes in text and `--json` forms, including at least session id/key, profile, cwd, runtime PID, agent/PTY PID, controller reachability, started time, and attached-client count/state.
- Add safe stale-entry pruning to `airelay detached --prune`. It must verify runtime/controller liveness and avoid PID reuse mistakes before deleting an entry. Active detached runtimes must not be killed by the existing `airelay cleanup` orphan logic merely because their original launcher exited.
- Reuse/extend the canonical existing session and PID stores after auditing them. Do not create a second duplicate persistence system for the same PID/session facts unless the report justifies it.
- Detached runtime shutdown must be explicit and bounded. A runtime exit must clean its registry/session record; an unclean death must become a stale registry entry that `detached --prune` can remove without killing unrelated processes.
- Keep local IPC access safe and platform-compatible with the existing endpoint abstraction. Raw attach input is a narrow PTY input operation, not arbitrary shell execution or a general remote command API.

## Non-goals
- No changes to Gateway, GPT Tunnel, Hub, or other repositories.
- No default detached behavior for ordinary `airelay start`; only explicit `--no-attach` changes lifecycle.
- No transcript duplication or persistent viewport log solely for attach.
- No arbitrary remote shell, process kill through raw input, SIGKILL, or broad process-control API.
- No changes to prompt timing, interrupt semantics, capacity watcher, or delivery retry behavior except tests proving they remain unchanged.
- No version bump, commit, push, release, or tag before master validates the report.

## Acceptance criteria
- [ ] Ordinary interactive `airelay start` uses the existing direct PTY path; focused regression proves stdin forwarding and resize do not wait for the 200 ms viewport polling interval.
- [ ] `airelay start --detached <profile> ...` returns a structured/text startup receipt with session key/id, runtime PID, agent PID, and controller endpoint; launcher stdin/stdout are not inherited by the detached runtime.
- [ ] Detached runtime survives launcher/client exit and remains reachable by controller ping; no second PTY/agent is created by `attach`.
- [ ] `airelay attach <session>` renders the current viewport at no more than 5 updates/sec and disconnects without stopping the runtime.
- [ ] Attach raw input and resize are sent immediately via dedicated IPC, independently of viewport polling; tests prove a raw input write is not delayed by the polling interval and does not append an unintended Enter.
- [ ] Existing `airelay prompt <session> ...` still reaches the detached runtime, with one delivery and the existing prompt timing/watcher semantics.
- [ ] `airelay detached` and `airelay detached --json` list the required runtime/session/PID/controller fields; records are keyed by stable runtime identity plus session key and duplicate-key ambiguity is deterministic.
- [ ] `airelay detached --prune` removes only confirmed stale entries; PID reuse and live controller cases are protected; `airelay cleanup` does not kill active detached runtimes.
- [ ] Explicit runtime stop/exit cleans the registry and session state; client detach never stops the runtime.
- [ ] Tests use `test/utils.ts` isolation and never write to the real `~/.airelay`.
- [ ] `npm run -s build`, `npm run -s lint`, `npm run -s format:check`, `npm test -- --runInBand`, and `npm audit` pass.
- [ ] Final report is copied from `tasks/report_stub.md`, drafted first, renamed to the exact final report path, and maps every criterion to evidence and exit codes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit`
- focused controller protocol tests for attach/raw-input/resize and client disconnect
- focused detached lifecycle tests for start, registry, PID liveness, prune, cleanup isolation, and duplicate-key resolution
- focused interactive-start regression proving direct PTY input path is not polling-delayed

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_078_add_detached_runtime_registry_and_attach_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/todo/task_078_add_detached_runtime_registry_and_attach_report_draft.md tasks/todo/task_078_add_detached_runtime_registry_and_attach_report.md`
- The final report file name MUST be exactly `tasks/todo/task_078_add_detached_runtime_registry_and_attach_report.md`.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped with explicit `pass`/`fail` status and supporting evidence.
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_078_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- explicit detached runtime path and lifecycle registry
- attach viewport client with immediate raw input/resize forwarding
- tests for default start non-regression and detached lifecycle
- report at `tasks/todo/task_078_add_detached_runtime_registry_and_attach_report.md`
