# Task

## ID
`deepseek_016_remove_stdin_mode_split_and_unify_start_behavior`

## Agent
`DeepSeek`

## Execution Order
`16`

## File Ownership
- `src/commands/start.ts`
- `src/commands/run.ts`
- `src/commands/resume.ts`
- `src/cli.ts`
- `README.md`
- `test/cli*.test.ts`
- `test/start*.test.ts`
- `test/run*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Remove stdin-mode split and unify launch behavior on PTY-backed promptable sessions

## Context
After PTY foundation, old inherit-vs-pipe logic should be removed to avoid ambiguous behavior.

## Scope
- Remove now-obsolete split assumptions around `pipeStdin` for interactive capability.
- Ensure `airelay start <profile> [args...]` is the canonical always-promptable launch path.
- Ensure harness-native args passthrough remains fully supported.
- Ensure error/help messaging reflects unified behavior.

## Non-goals
- Do not add remote proxy features.
- Do not reintroduce profile shortcut launch behavior.

## Acceptance criteria
- Start path is promptable by default and terminal-compatible for harness args.
- No residual code path that depends on old stdin split for interactive launches.
- CLI/docs/tests reflect unified behavior and remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli start run resume prompt`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_016_remove_stdin_mode_split_and_unify_start_behavior_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_016_remove_stdin_mode_split_and_unify_start_behavior_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_016_remove_stdin_mode_split_and_unify_start_behavior_report.md`
