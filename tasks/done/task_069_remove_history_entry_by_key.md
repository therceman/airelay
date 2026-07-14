# Task 069: Remove Launch History by Key

## ID
`task_069_remove_history_entry_by_key`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/commands/history.ts`
- `src/cli.ts`
- `test/history.test.ts`
- `test/cli-runCli.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Remove current-directory launch history by session key

## Scope
- Add `airelay history remove <session-key>`.
- Match the key exactly and remove only history entries whose invocation directory is the current working directory.
- Preserve entries with the same key from other directories.
- Report how many entries were removed, or that no matching current-directory entry exists.
- Validate the CLI subcommand and key argument with actionable usage output.
- Add command-level and CLI dispatch tests.

## Non-goals
- Do not delete history from other directories.
- Do not change active session/controller state.
- Do not change history listing, persistence schema, or command rendering.

## Acceptance criteria
- `airelay history remove wowage_master` removes matching entries only from the current directory.
- Entries with the same key in other directories remain.
- Missing/invalid subcommand arguments show usage without mutating history.
- Tests and full verification pass.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm run verify`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_069_remove_history_entry_by_key_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to:
  - `tasks/todo/task_069_remove_history_entry_by_key_report.md`
- Move the task and final report to `tasks/done/` after acceptance.
- The report MUST use exact section headings/order from `tasks/report_stub.md`.
- Every validation command MUST be listed with exit code.
- Every acceptance criterion MUST be mapped with explicit status and evidence.

## Deliverables
- code changes
- report at `tasks/done/task_069_remove_history_entry_by_key_report.md`
