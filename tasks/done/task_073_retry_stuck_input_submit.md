# Task 073: Retry Stuck Input Submission

## ID
`task_073_retry_stuck_input_submit`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/runtime/input-submit-watcher.ts`
- `src/commands/run.ts`
- `src/controller/index.ts`
- `src/utils/harness.ts`
- `test/input-submit-watcher.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Retry submit when injected input remains stuck in the live terminal

## Scope
- Track text-plus-submit injections from the PTY controller.
- After 10 seconds without meaningful output activity, inspect the live xterm viewport.
- If the injected text is still visible, send only the original submit key again; never retype the message.
- Reset the idle window on output activity and stop when the input disappears.
- Cap retries at three and clean timers on session exit.
- Configure this capability for Codex through harness capabilities.
- Add deterministic tests for retry timing, visibility, activity, cap, and disposal.

## Non-goals
- Do not change prompt payload formatting or resend text automatically.
- Do not change controller IPC protocol.
- Do not implement the complete durable reliable-delivery state machine.

## Acceptance criteria
- Stuck visible input receives submit-only retry after 10 seconds.
- Output activity resets the 10-second window.
- Invisible/accepted input is not retried.
- Original text is never duplicated.
- Maximum three retries and cleanup are enforced.
- Full application gates and production audit pass.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm audit --omit=dev`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_073_retry_stuck_input_submit_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- Rename it to `tasks/todo/task_073_retry_stuck_input_submit_report.md` when complete.
- Move task and final report to `tasks/done/` after acceptance.
- Use exact report headings/order and map every acceptance criterion with evidence.

## Deliverables
- code changes
- report at `tasks/done/task_073_retry_stuck_input_submit_report.md`
