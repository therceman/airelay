# Task

## ID
`deepseek_013_add_sessions_command_for_promptable_runtime_visibility`

## Agent
`DeepSeek`

## Execution Order
`13`

## File Ownership
- `src/commands/sessions-list.ts` (new)
- `src/commands/sessions.ts`
- `src/cli.ts`
- `test/cli*.test.ts`
- `test/sessions*.test.ts`
- `test/sessions-list*.test.ts` (new)

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Add `airelay sessions` command to show promptable/current session visibility

## Context
`airelay list` shows profiles but not current controllable sessions for `airelay prompt`.

## Scope
- Add CLI command:
  - `airelay sessions`
  - `airelay sessions --json`
  - `airelay sessions --active`
- `sessions` output MUST include these core fields:
  - sessionId
  - profile
  - cwd (original start working directory)
- `cwd` must render home-prefixed paths as `~` (e.g. `/home/user/project` -> `~/project`).
- Additional fields may be shown (e.g., sessionKey, controller endpoint, lastUsed, active/reachable status) but core fields above are mandatory.
- `--active` should filter to currently controllable sessions only.
- Active detection should use safe local checks (e.g. endpoint exists/reachable), with platform-aware behavior.
- Update help text with usage/examples.

## Non-goals
- Do not redesign session persistence schema.
- Do not add remote/proxy discovery.

## Acceptance criteria
- `airelay sessions` shows saved sessions with mandatory fields: `sessionId`, `profile`, `cwd` (with `~` home normalization).
- `airelay sessions --json` emits machine-readable JSON.
- `airelay sessions --active` filters to sessions currently controllable by prompt.
- CLI/help/tests updated and green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- sessions cli prompt`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_013_add_sessions_command_for_promptable_runtime_visibility_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_013_add_sessions_command_for_promptable_runtime_visibility_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_013_add_sessions_command_for_promptable_runtime_visibility_report.md`
