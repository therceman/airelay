# Task: Add `airelay sessions --cwd` Filtering

## Task ID
`deepseek_034_add_sessions_cwd_repo_filters`

## Context
Need an ergonomic way to list active/saved sessions scoped to current working directory:
- `airelay sessions --cwd`

Current command lists all sessions globally.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_034_add_sessions_cwd_repo_filters_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_034_add_sessions_cwd_repo_filters_report_draft.md tasks/deepseek_034_add_sessions_cwd_repo_filters_report.md`

## Scope
Implement directory-scoped filtering for `sessions` command.

### Behavior requirements
1. `--cwd`
- Show sessions whose recorded `cwd` matches current directory exactly.

2. Compatibility
- Works with `--active` and `--json` combinations.
- No change to default behavior when flag is not used.

3. Path normalization
- Compare with normalized absolute paths.
- Keep displayed `cwd` output behavior unchanged (home as `~` etc.).

## Primary file ownership
- `src/cli.ts`
- `src/commands/sessions-list.ts`
- `test/sessions-list.test.ts`
- `test/cli-runCli.test.ts` (if needed)

## Acceptance criteria
1. `airelay sessions --cwd` filters to sessions started in current directory.
2. Works with `--active` and `--json`.
3. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- sessions-list cli-runCli`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_034_add_sessions_cwd_repo_filters_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete file/test evidence.

## Constraints
- Minimal/surgical change.
- Do not alter session persistence schema.
- No aliases (`--dir`, `--project`, `--repo`) in this task.
