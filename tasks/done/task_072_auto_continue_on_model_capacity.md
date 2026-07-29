# Task 072: Auto-Continue After Model Capacity Interruption

## ID
`task_072_auto_continue_on_model_capacity`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/runtime/capacity-watcher.ts`
- `src/commands/run.ts`
- `src/utils/harness.ts`
- `test/capacity-watcher.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Automatically submit continue after a Codex model-capacity interruption

## Scope
- Detect the exact normalized final output line `Selected model is at capacity. Please try a different model.` on PTY-backed harness sessions.
- Add the behavior through harness capabilities, not generic profile-name branching.
- For Codex-capable sessions, wait 10 seconds of quiet time, write `continue`, then submit it after the configured 2-second input-settle delay.
- Ignore duplicate observations of one interruption and allow a new interruption after the continuation cycle.
- Handle ANSI sequences and output split across PTY chunks.
- Cancel pending timers when output changes or the session exits.
- Do not send automatic continuation for unsupported harnesses.
- Add deterministic watcher tests.

## Non-goals
- Do not implement the full reliable delivery/watch persistence protocol yet.
- Do not add automatic model switching.
- Do not change legacy prompt command semantics or controller IPC protocol.

## Acceptance criteria
- Exact capacity message triggers one automatic `continue` after 10 seconds quiet time.
- `continue` is submitted after the configured 2-second delay.
- Duplicate observations do not duplicate input.
- Split/ANSI output is recognized.
- Non-Codex/unsupported capabilities do not send continuation.
- Timers are cleaned up on session exit.
- Application gates pass; production dependency audit passes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm audit --omit=dev`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_072_auto_continue_on_model_capacity_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- Rename it to `tasks/todo/task_072_auto_continue_on_model_capacity_report.md` when complete.
- Move task and final report to `tasks/done/` after acceptance.
- Use exact report headings/order and map every acceptance criterion with evidence.

## Deliverables
- code changes
- report at `tasks/done/task_072_auto_continue_on_model_capacity_report.md`
