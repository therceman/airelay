# Task

## ID
`deepseek_017_post_pty_migration_review`

## Agent
`DeepSeek`

## Execution Order
`17`

## File Ownership
- `tasks/deepseek_015_pty_proxy_foundation_for_always_promptable_sessions_report.md`
- `tasks/deepseek_016_remove_stdin_mode_split_and_unify_start_behavior_report.md`
- `tasks/deepseek_017_post_pty_migration_review_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Post-migration deep review for PTY promptability + harness-arg compatibility

## Context
Run after tasks 015 and 016 complete.

## Scope
- Verify acceptance criteria of tasks 015/016 against actual code/tests.
- Review PTY lifecycle/resource cleanup for leaks/regressions.
- Review prompt delivery correctness under PTY mode.
- Provide P0..P4 findings and concrete follow-up tasks if needed.

## Non-goals
- Do not implement fixes unless explicitly assigned.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run start resume prompt cli`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the post-review stub:
  - `cp tasks/post_review_report_stub.md tasks/deepseek_017_post_pty_migration_review_report.md`
- Fill that copied file only; do not create custom post-review report structure.
- Report file name MUST be exactly `tasks/deepseek_017_post_pty_migration_review_report.md`.
- Report MUST follow required structure from `tasks/deepseek_post_task_review_template.md`.
- Include `## Findings` grouped by `P0..P4`; each finding must include severity, file path, problem, impact, recommendation.
- Include validation commands with exit codes.

## Deliverables
- report at `tasks/deepseek_017_post_pty_migration_review_report.md`
