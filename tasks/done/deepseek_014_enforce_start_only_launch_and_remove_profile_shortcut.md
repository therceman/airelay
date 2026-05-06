# Task

## ID
`deepseek_014_enforce_start_only_launch_and_remove_profile_shortcut`

## Agent
`DeepSeek`

## Execution Order
`14`

## File Ownership
- `src/cli.ts`
- `src/commands/start.ts`
- `src/commands/run.ts`
- `src/commands/resume.ts` (only if behavior coupling requires update)
- `README.md`
- `test/cli*.test.ts`
- `test/cli-runCli.test.ts`
- `test/cli-integration.test.ts`
- `test/start*.test.ts` (new if needed)

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Enforce explicit `start` launch path; remove profile shortcut ambiguity

## Context
Current behavior diverged: `airelay <profile>` and `airelay start <profile>` are no longer equivalent. This creates confusion and inconsistent promptability.

## Scope
- Remove profile-as-command shortcut behavior OR hard-error it with actionable guidance (preferred: hard-error with migration message).
- Canonical launch path must be:
  - `airelay start <profile> [profile_args...]`
- Ensure `start` supports passthrough profile args correctly (e.g. `resume <id>`, `-s <id>`).
- Ensure `start` sessions remain promptable by design.
- Update CLI help, usage text, and docs to remove ambiguity.
- Add/update tests for:
  - shortcut rejection behavior
  - start passthrough args
  - start promptable/session metadata behavior

## Non-goals
- Do not add proxy/network integration.
- Do not redesign session schema.
- Do not change `resume` command contract.

## Acceptance criteria
- `airelay <profile>` no longer silently launches profile (must be removed or explicit error with guidance).
- `airelay start <profile> <profile_args...>` reliably launches with passthrough args.
- `start` launch path yields promptable sessions consistent with current prompt architecture.
- CLI/help/docs/tests are updated and green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli start run resume prompt`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_014_enforce_start_only_launch_and_remove_profile_shortcut_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_014_enforce_start_only_launch_and_remove_profile_shortcut_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_014_enforce_start_only_launch_and_remove_profile_shortcut_report.md`
