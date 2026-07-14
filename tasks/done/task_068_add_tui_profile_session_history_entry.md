# Task 068: Add TUI Profile Session History Entry

## ID
`task_068_add_tui_profile_session_history_entry`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/commands/select.ts`
- `test/select.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Add profile session history to the airelay TUI menu

## Scope
- Add `Show profile session history` as the second main TUI choice when sessions exist, after `Resume` and before `Start`.
- Keep the history entry available when there are no active sessions, so the main menu becomes `Show`, `Start`, `Create`.
- Route the action to the existing launch-history listing filtered to the current invocation directory.
- Return to the shell after showing history; do not enter profile selection or launch a harness.
- Keep existing Resume, Start, and Create behavior unchanged.
- Add tests for menu ordering with and without active sessions.

## Non-goals
- Do not change launch-history persistence or output formatting.
- Do not add automatic resume or command execution.
- Do not change active session/controller behavior.

## Acceptance criteria
- `airelay` displays `Resume`, `Show profile session history`, `Start`, `Create` in that order when active sessions exist.
- `airelay` displays `Show profile session history`, `Start`, `Create` when no active sessions exist.
- Selecting Show invokes current-directory history listing and exits without starting a profile.
- Existing selector tests and full verification pass.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm run verify`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_068_add_tui_profile_session_history_entry_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/todo/task_068_add_tui_profile_session_history_entry_report_draft.md tasks/todo/task_068_add_tui_profile_session_history_entry_report.md`
- The final report file name MUST be exactly `tasks/done/task_068_add_tui_profile_session_history_entry_report.md` after lifecycle completion.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped with explicit status and evidence.
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- code changes
- report at `tasks/done/task_068_add_tui_profile_session_history_entry_report.md`
