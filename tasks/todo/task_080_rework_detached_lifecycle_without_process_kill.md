# Task 080: Rework detached lifecycle without process-kill watchdog

## ID
`task_080_rework_detached_lifecycle_without_process_kill`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- Current task-079 modified production files under `src/`
- current attach/detached tests under `test/`
- `tasks/rework/task_079_restore_true_pty_attach_stream.md`
- `tasks/rework/task_079_restore_true_pty_attach_stream_report.md`
- `tasks/todo/task_080_rework_detached_lifecycle_without_process_kill_report_draft.md`
- `tasks/todo/task_080_rework_detached_lifecycle_without_process_kill_report.md`

## Title
Remove unsafe detached watchdog kill and revalidate true PTY attach

## Baseline
- Master baseline before task 079: `751f9d6` / Airelay `0.1.68`.
- Current worktree contains the uncommitted task-079 implementation and tests. Continue from that exact state; do not discard or reset it.
- Task 079 is in `tasks/rework` because its report introduced a prohibited process-kill watchdog. Do not move it to done until this correction is accepted.
- Do not bump version, commit, push, tag, release, or publish. Master handles that after accepting task 079 plus this correction.

## Blocking Defect
The task-079 implementation added:
- `SpawnOptions.onPtyReady.kill` / PTY kill exposure;
- `ptyKillRef` in `run.ts`;
- a detached controller watchdog that calls `ptyKillRef.current?.('SIGTERM')` after probe failures.

Task 079 explicitly forbids process kill, `SIGTERM`, `SIGKILL`, PTY destruction/recreation, and session recreation. Remove this unsafe mechanism completely.

## Required Corrections

### 1. Remove process-control violation
- Remove `kill` from the `onPtyReady` callback contract and all `ptyKillRef`/watchdog/SIGTERM production paths introduced by task 079.
- Remove any watchdog-only env flags, constants, timers, tests, and report claims that depend on killing the agent.
- Do not replace it with SIGKILL, SIGINT, child teardown, PTY destruction, or a hidden process-control API.
- Keep the bounded `SessionController.stop()` socket cleanup only if it is strictly client-connection cleanup and does not kill the agent/session.

### 2. Preserve the valid stream attach work
- Keep the lossless typed PTY stream framing, bounded bootstrap/ring, ordering guarantee, immediate raw input/resize, no clear/redraw polling, and deterministic multiple-client behavior from task 079.
- Keep ordinary direct `airelay start` unchanged.
- Keep `Ctrl-D`/EOF/client close as detach-only; `Ctrl-C` remains raw PTY input and must not be presented as an attach escape.

### 3. Re-evaluate controller-loss lifecycle honestly
The earlier live test observed a missing controller socket with a still-live runtime PID. After removing the kill watchdog, determine what the existing architecture can safely guarantee without process destruction:
- If controller loss can be detected through an existing safe lifecycle path and the runtime naturally exits, implement and test that path.
- If safe termination of an already-running agent is impossible without a prohibited process-control operation, do not fake cleanup. Report the exact source-level blocker and make the registry/session state deterministic and truthful (for example, mark the entry controller-unreachable/stale rather than presenting it as promptable).
- `airelay prompt` must not claim a session is usable when its controller is gone.
- `airelay detached --prune` must remain safe: no killing, no PID reuse mistake, no deletion of a reachable runtime.
- Do not add a generic updater/remote shell/process-control API.

## Mandatory Regressions
Tests must prove:
- no production path added by task 079 exposes or calls PTY/process kill for controller-loss cleanup;
- raw stream ANSI/control/UTF-8 forwarding remains lossless and ordered;
- attach does not clear/redraw on a polling timer;
- attach raw input and resize remain immediate and exact;
- attach bootstrap has no duplicate/lost boundary bytes;
- Ctrl-D/EOF/client close leaves a healthy detached runtime alive and reattachable;
- Ctrl-C is forwarded as `0x03` and is not an attach escape;
- prompt and interrupt still use the canonical controller;
- controller-loss behavior is deterministic and truthful without killing a process;
- no unbounded per-client buffer/listener/timer remains;
- older controller compatibility errors remain clear.

Tests must use `test/utils.ts` isolation and never write to real `~/.airelay`.

## Validation
Run and include exit codes and timings:
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit`
- `npx jest test/attach.test.ts --runInBand`
- `npx jest test/detached.test.ts --runInBand`

Also include a source-level search proving no task-079-added `ptyKillRef`, `onPtyReady.kill`, detached watchdog `SIGTERM`, `SIGKILL`, or equivalent kill path remains.

## Reporting Contract (Mandatory)
- First copy the canonical stub:
  - `cp tasks/report_stub.md tasks/todo/task_080_rework_detached_lifecycle_without_process_kill_report_draft.md`
- Fill only the draft while working.
- Rename it to:
  - `tasks/todo/task_080_rework_detached_lifecycle_without_process_kill_report.md`
  only after implementation and validation are complete.
- The final report must include source audit, exact removed paths, lifecycle limitation or fix, changed files, duplicate/performance review, every validation command with exit code, and explicit pass/fail acceptance mapping.
- A copied stub, empty report, or report claiming pass while prohibited kill code remains is incomplete.
- After final report creation, send:
  - `airelay prompt gpt_master_airelay "task_080_done"`

## Completion
Task 079 remains rejected until task 080 is reviewed and accepted. Do not bump version or commit/push from the worker.
