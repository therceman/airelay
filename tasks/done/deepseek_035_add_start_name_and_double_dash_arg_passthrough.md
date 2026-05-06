# Task: Add `airelay start --name` and `--` Arg Passthrough Contract

## Task ID
`deepseek_035_add_start_name_and_double_dash_arg_passthrough`

## Context
Need clean separation between `airelay start` flags and profile/harness args, plus a per-session human label.

Target CLI:
- `airelay start <profile> [--name <session_name>] -- <profile_args...>`

No `--tag` in this task.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_035_add_start_name_and_double_dash_arg_passthrough_report_draft.md`
2. Complete draft with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_035_add_start_name_and_double_dash_arg_passthrough_report_draft.md tasks/deepseek_035_add_start_name_and_double_dash_arg_passthrough_report.md`

## Scope
Implement:
1. `--name <session_name>` for `start`
- Save as session name metadata for launched session.

2. `--` passthrough separation
- Args after `--` go to harness/profile executable verbatim.
- Args before `--` are parsed as `airelay` flags.

3. Backward compatibility
- If `--` not present, existing behavior should remain sensible and not break existing start usage.

## Primary file ownership
- `src/cli.ts`
- `src/commands/start.ts`
- `src/commands/run.ts` (if needed for session metadata propagation)
- `src/commands/sessions.ts`
- tests: `test/cli-runCli.test.ts`, `test/run.test.ts`, and/or `test/sessions*.test.ts`

## Implementation requirements
1. CLI parsing
- Parse `--name` for `start` only.
- Respect `--` separator for profile args.

2. Session metadata
- Ensure launched session record stores provided `name`.
- Ensure name shows in existing session listing output where appropriate.

3. Validation/UX
- Actionable error if `--name` is empty.
- Keep help text/examples updated.

## Acceptance criteria
1. `airelay start opencode2 --name deepseek_worker_1 -- -s ses_xxx` passes `-s ses_xxx` to harness and stores session name.
2. `airelay start ... --name ...` without `--` still behaves compatibly.
3. Session name is visible in session listing output.
4. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli run sessions sessions-list`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_035_add_start_name_and_double_dash_arg_passthrough_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete file/test evidence.

## Constraints
- Minimal/surgical changes.
- No `--tag` in this task.
- Do not alter unrelated prompt/control runtime logic.
