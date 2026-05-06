# Task

## ID
`deepseek_009_hardening_session_cleanup_signal_and_resume_tests`

## Agent
`DeepSeek`

## Execution Order
`9`

## File Ownership
- `src/commands/sessions.ts`
- `src/runtime/spawn.ts`
- `src/commands/resume.ts` (only if required for testability)
- `test/resume*.test.ts` (new if missing)
- `test/sessions*.test.ts`
- `test/spawn*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Hardening pass: session removal safety, spawn signal listener hygiene, and resume key-reuse tests

## Scope
- Fix `removeSessionByKey` collision risk so temp-session cleanup cannot remove wrong record when keys collide.
- Ensure `spawnAndWait` does not accumulate SIGINT/SIGTERM listeners across repeated runs.
- Add explicit tests for resume session-key reuse behavior.
- Keep backward compatibility and preserve current CLI behavior.

## Non-goals
- Do not redesign session persistence schema.
- Do not add proxy/network integration.
- Do not perform broad refactors outside owned files.

## Acceptance criteria
- `removeSessionByKey` uses deterministic safe matching that prefers/removes intended pending session.
- `spawnAndWait` cleans up signal listeners after child exit and avoids listener accumulation.
- New tests verify resume reuses session key binding.
- Existing run/resume/sessions/spawn/prompt tests remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- resume sessions spawn run prompt`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_009_hardening_session_cleanup_signal_and_resume_tests_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_009_hardening_session_cleanup_signal_and_resume_tests_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_009_hardening_session_cleanup_signal_and_resume_tests_report.md`
