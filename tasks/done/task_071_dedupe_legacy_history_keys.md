# Task 071: Deduplicate Legacy History Keys

## ID
`task_071_dedupe_legacy_history_keys`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/commands/history.ts`
- `test/history.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Remove legacy duplicate launch-history entries by session key

## Scope
- Normalize loaded launch history to one newest entry per session key.
- Persist the normalized history so legacy duplicate records are physically removed.
- Preserve the newest command, profile, cwd, and arguments for each key.
- Add a regression test for an older command followed by a newer command using the same key.

## Non-goals
- Do not change current-directory/all filtering semantics.
- Do not change active sessions, resume, controller, or prompt behavior.

## Acceptance criteria
- Loading history removes legacy duplicate entries with the same key.
- The newest entry survives with its latest command arguments.
- The cleaned history is persisted to disk.
- Full verification passes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm run verify`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_071_dedupe_legacy_history_keys_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- Rename it to `tasks/todo/task_071_dedupe_legacy_history_keys_report.md` when complete.
- Move task and final report to `tasks/done/` after acceptance.
- Use exact report headings/order and map every acceptance criterion with evidence.

## Deliverables
- code changes
- report at `tasks/done/task_071_dedupe_legacy_history_keys_report.md`
