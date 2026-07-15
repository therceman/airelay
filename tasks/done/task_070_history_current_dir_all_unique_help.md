# Task 070: Refine Launch History Scope and Output

## ID
`task_070_history_current_dir_all_unique_help`

## Agent
`Codex`

## Execution Order
`1`

## File Ownership
- `src/commands/history.ts`
- `src/commands/select.ts`
- `src/cli.ts`
- `test/history.test.ts`
- `test/cli-runCli.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Make history current-directory scoped, unique by key, and self-documented

## Scope
- Make `airelay history` list only launch history from the current directory.
- Add `--all` to list history from all directories.
- Keep JSON output consistent with the same current-directory/all filter.
- Enforce one stored history entry per session key; a new launch with an existing key replaces the old entry.
- Add `airelay history help` describing default behavior, `--all`, JSON output, and `remove`.
- Remove the `started:` line from human-readable output and render the command as `> airelay ...`.
- Keep `history remove <key>` current-directory scoped and preserve the TUI history action.

## Non-goals
- Do not change active sessions, resume, controller, or prompt behavior.
- Do not add automatic command execution.

## Acceptance criteria
- Default history output is current-directory-only.
- `--all` lists all directories.
- History is unique by session key.
- Help documents behavior and remove command.
- Output has only context line and `> airelay ...` command line, without `started:`.
- Full verification passes.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test`
- `npm run verify`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_070_history_current_dir_all_unique_help_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- Rename it to `tasks/todo/task_070_history_current_dir_all_unique_help_report.md` when complete.
- Move task and final report to `tasks/done/` after acceptance.
- Use exact report headings/order and map every acceptance criterion with evidence.

## Deliverables
- code changes
- report at `tasks/done/task_070_history_current_dir_all_unique_help_report.md`
