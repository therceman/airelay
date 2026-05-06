# Task

## ID
`deepseek_003_run_resume_integration_and_validation`

## Agent
`DeepSeek`

## Execution Order
`3`

## File Ownership
- `src/runtime/spawn.ts`
- `src/commands/run.ts`
- `src/commands/start.ts`
- `src/commands/resume.ts`
- `src/commands/sessions.ts`
- `test/run*.test.ts`
- `test/resume*.test.ts`
- `test/sessions*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Integrate runtime launch with controller-managed controllable sessions

## Scope
- Update launch flow so started sessions are controller-backed and promptable.
- Persist controller endpoint metadata in session records.
- Ensure `resume` keeps/refreshes controller binding for the same session.
- Guarantee shutdown cleanup removes stale controller endpoints.
- Add integration tests demonstrating:
  - start session
  - prompt into session
  - success acknowledgment

## Non-goals
- Do not implement remote API/proxy token handshake.
- Do not redesign TUI UX in this task.

## Acceptance criteria
- `airelay <profile>` produces a session that can accept `airelay prompt`.
- Session metadata includes enough routing info for prompt delivery.
- Cleanup path removes stale sockets/pipes when runtime exits.
- Tests verify behavior and regressions.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run resume sessions prompt`

## Reporting Contract (Mandatory)
- Report file name MUST be exactly `tasks/deepseek_003_run_resume_integration_and_validation_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` covering every criterion in this task with `pass|fail` and evidence.
- Report MUST include `## Validation Commands` with exit codes for every command listed in this task.
- Missing, renamed, out-of-order, or empty required sections make the task incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_003_run_resume_integration_and_validation_report.md`
