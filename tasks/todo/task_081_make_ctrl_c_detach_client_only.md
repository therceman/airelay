# Task 081: Make Ctrl-C detach the attach client without stopping runtime

## ID
`task_081_make_ctrl_c_detach_client_only`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/commands/attach.ts`
- attach/detached focused tests under `test/`
- `tasks/todo/task_081_make_ctrl_c_detach_client_only_report_draft.md`
- `tasks/todo/task_081_make_ctrl_c_detach_client_only_report.md`

## Title
Make Ctrl-C detach only the attach client

## Baseline
- Start from clean pushed master `d8bc83d`.
- Airelay version: `0.1.69`.
- Task 079/080 lossless PTY stream attach is accepted and already in `tasks/done`.
- Do not bump version, commit, push, tag, release, or publish. Master will do that after review.

## Observed Live Defect
In a real detached Muse Spark 1.2 Free session, the user pressed `Ctrl+C` while attached. The current attach client forwarded `0x03` into the opencode PTY; the harness exited, the runtime/controller disappeared, and the session could not be attached again. This is technically consistent with raw-input semantics but is unsafe and confusing for an attach client.

## Required Behavior
- In `airelay attach <session>`, a single `Ctrl+C` byte (`0x03`) must detach only the local attach client.
- `Ctrl+C` must not be forwarded to the underlying PTY and must not send any `session.input.raw` message for that byte.
- Detaching with `Ctrl+C` must not kill, interrupt, recreate, or restart the detached runtime, agent, PTY, or controller.
- After `Ctrl+C` detach, the same session must remain controller-reachable, promptable, and re-attachable.
- Keep `Ctrl+D`/EOF/client terminal close as detach-only behavior.
- Keep active-turn interruption as the separate canonical `airelay interrupt <session>` / `session.interrupt` path. Do not silently turn attach `Ctrl+C` into a controller interrupt.
- Ordinary direct `airelay start <profile>` stdin behavior must remain unchanged; this change is only for `AttachClient`.
- Use the existing attach IPC and lifecycle abstractions. Do not add process kill, SIGTERM, SIGKILL, PTY destruction, session recreation, or arbitrary remote shell behavior.
- Update help/comments/report wording so `Ctrl+C` is no longer described as raw attach input.

## Mandatory Tests
Add deterministic tests proving:
- `AttachClient.writeRaw(Buffer.from([0x03]))` calls `onDetach('ctrl-c')` exactly once and sends no raw input;
- repeated Ctrl-C after detach sends no further data and does not call detach twice;
- Ctrl-D behavior remains detach-only and sends no raw input;
- non-control raw bytes still forward exactly and immediately;
- detached E2E: attach, send Ctrl-C, verify runtime PID/agent PID/controller remain alive and registry attached count returns to zero;
- detached E2E: re-attach the same session after Ctrl-C and successfully prompt it;
- `session.interrupt` / `airelay interrupt` remains the only active-turn interrupt path and existing interrupt tests still pass;
- ordinary direct PTY start still receives Ctrl-C unchanged.

Tests must use `test/utils.ts` isolation and never write to real `~/.airelay`.

## Validation
Run and include exit codes and timings in the report:
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit`
- `npx jest test/attach.test.ts --runInBand`
- `npx jest test/detached.test.ts --runInBand`

## Reporting Contract (Mandatory)
- First copy the canonical stub:
  - `cp tasks/report_stub.md tasks/todo/task_081_make_ctrl_c_detach_client_only_report_draft.md`
- Fill only the draft while working.
- Rename it to the exact final path only after implementation and validation:
  - `tasks/todo/task_081_make_ctrl_c_detach_client_only_report.md`
- Include exact changed files, behavior before/after, no-process-control proof, all validation commands with exit codes, focused runtime evidence, duplicate/performance review, and explicit pass/fail acceptance mapping.
- A stub-only, empty, or incomplete report is failure.
- After the final report exists, send:
  - `airelay prompt gpt_master_airelay "task_081_done"`

## Completion
- Do not commit or push from the worker.
- Master will review, move the task to `tasks/done`, bump version, commit, and push only after acceptance.
