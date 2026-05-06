# Task

## ID
`deepseek_010_post_hardening_deep_review_dupes_perf`

## Agent
`DeepSeek`

## Execution Order
`10`

## File Ownership
- `tasks/deepseek_009_hardening_session_cleanup_signal_and_resume_tests_report.md`
- `tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Deep post-hardening code review focused on duplicate code and performance risks

## Context
Run after task `deepseek_009_hardening_session_cleanup_signal_and_resume_tests` is complete.

## Scope
- Verify task 009 acceptance criteria against code and tests.
- Deeply inspect prompt/session/controller/run/resume/sessions/spawn paths for:
  - duplicate code
  - unnecessary complexity
  - potential performance risks
  - listener/resource lifecycle leaks
- Produce actionable findings with file-level ownership for follow-up tasks.

## Non-goals
- Do not implement fixes in this task unless explicitly requested.
- Do not review unrelated project areas.

## Required review sections
- Executive summary.
- Acceptance criteria verification (task 009).
- Findings grouped by severity P0..P4.
- Duplicate-code findings.
- Performance-risk findings.
- Test/validation gap findings.
- Required follow-up tasks with non-overlapping ownership.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- resume sessions spawn run prompt select`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the post-review stub:
  - `cp tasks/post_review_report_stub.md tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`
- Fill that copied file only; do not create custom post-review report structure.
- Report file name MUST be exactly `tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`.
- Report MUST follow required structure from `tasks/deepseek_post_task_review_template.md`.
- Include `## Findings` grouped by `P0..P4`; each finding must include severity, file path, problem, impact, recommendation.
- Include validation commands with exit codes.

## Deliverables
- report at `tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`
