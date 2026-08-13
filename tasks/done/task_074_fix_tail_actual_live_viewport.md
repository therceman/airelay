# Task 074: Fix `tail` to Read the Actual Live Viewport

## ID
`task_074_fix_tail_actual_live_viewport`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `src/controller/index.ts`
- `src/commands/session-viewport.ts` (only if required by the verified fix)
- `test/controller-e2e.test.ts`
- `test/*tail*.test.ts` (only if required by the verified fix)

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Fix `tail` returning a non-terminal section instead of the actual live viewport

## Scope
- Investigate the current `tail` path end to end: `tail` command, `session.viewport` IPC, and `SessionController` xterm buffer reads.
- Correct live viewport extraction so it starts at the xterm buffer position representing the currently displayed viewport, not merely the top of the bottom scrollback page.
- Preserve the existing behavior that `tail` is live viewport only and does not read transcript history or the rolling historical output buffer.
- Avoid changing transcript pagination, `session-find`, capacity watcher behavior, or command output formatting unless a directly shared helper requires a behavior-preserving adjustment.
- Keep blank-row handling and `--lines`/`--skip` semantics explicit and tested.

## Non-goals
- Do not redesign transcript storage or transcript pagination.
- Do not make `tail` read the transcript or historical scrollback.
- Do not add a new controller protocol version unless strictly required; document any incompatibility in the report.
- Do not bump the package version.
- Do not commit or push; the manager will validate, version, commit, and push after acceptance.

## Acceptance criteria
- `airelay tail <session> --lines N` returns the last N non-empty lines from the actual currently displayed viewport, including the bottom/end content visible in the launched terminal.
- The implementation uses the correct xterm viewport coordinate and does not assume `baseY` is always the visible viewport origin.
- Existing normal-buffer, alternate-buffer, wrapping, CR-overwrite, and scrolled-off behavior remains correct.
- Add a regression test that creates a deliberate difference between xterm `viewportY` and `baseY` (or an equivalent deterministic viewport state) and proves `tail` reads the visible section rather than the wrong scrollback page.
- Existing `--skip` behavior remains unchanged and is covered by the relevant test or existing tests.
- No unrelated source changes are introduced.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand test/controller-e2e.test.ts`
- Run any additional focused tail/viewport test added for this task.

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/task_074_fix_tail_actual_live_viewport_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/task_074_fix_tail_actual_live_viewport_report_draft.md tasks/task_074_fix_tail_actual_live_viewport_report.md`
- The final report file name MUST be exactly `tasks/task_074_fix_tail_actual_live_viewport_report.md`.
- The report MUST use exact section headings/order from `tasks/report_stub.md`.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence (file paths, test names, command output snippets).
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_074_fix_tail_actual_live_viewport_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.
- Do not mark the task complete without the report.

## Deliverables
- Minimal source and regression-test changes for the verified fix.
- Final report at `tasks/task_074_fix_tail_actual_live_viewport_report.md`.
