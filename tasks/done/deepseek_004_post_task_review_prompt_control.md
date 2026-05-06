# Task

## ID
`deepseek_004_post_task_review_prompt_control`

## Agent
`DeepSeek`

## Execution Order
`4`

## File Ownership
- `tasks/deepseek_001_session_controller_ipc_scaffold_report.md`
- `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md`
- `tasks/deepseek_003_run_resume_integration_and_validation_report.md`
- `tasks/deepseek_004_post_task_review_prompt_control_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Post-task deep review for local prompt-control feature set

## Context
Review implementation and reports from tasks `001..003` before marking feature complete.

## Scope
- Verify each acceptance criterion from tasks `001..003` against code and tests.
- Inspect for regressions in run/start/resume/session flows.
- Validate error-handling quality and actionable messages.
- Review duplicate code and performance risk in new controller/IPC path.
- Provide P0..P4 findings with file references.

## Non-goals
- Do not implement fixes unless explicitly assigned.
- Do not rewrite unrelated command behavior.

## Required review sections
- Executive summary.
- Acceptance criteria verification for each task.
- P0..P4 findings.
- Duplicate-code findings.
- Performance-risk findings.
- Test/validation gap findings.
- Required follow-up tasks with non-overlapping ownership.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test`

## Completion rule
- P0/P1 findings block completion.
- P2 findings require follow-up task or explicit acceptance by main agent.

## Reporting Contract (Mandatory)
- Report file name MUST be exactly `tasks/deepseek_004_post_task_review_prompt_control_report.md`.
- Report MUST follow exact sections from `tasks/deepseek_post_task_review_template.md`.
- Findings MUST be grouped by severity `P0`..`P4`; each finding must include severity, file path, problem, impact, recommendation.
- Report MUST include validation command exit codes.
- Missing, renamed, out-of-order, or empty required sections make the task incomplete.

## Deliverables
- report at `tasks/deepseek_004_post_task_review_prompt_control_report.md`
