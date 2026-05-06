# Task

## ID
`deepseek_006_rework_task3_controller_binding_and_e2e`

## Agent
`DeepSeek`

## Execution Order
`6`

## File Ownership
- `src/commands/run.ts`
- `src/commands/resume.ts`
- `src/commands/sessions.ts`
- `src/commands/prompt.ts`
- `test/run*.test.ts`
- `test/resume*.test.ts`
- `test/prompt*.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Close task-3 gaps: persisted controller endpoint, resume binding, and real prompt E2E validation

## Context
Task `deepseek_003_run_resume_integration_and_validation` report passes format checks, but code-level validation found behavioral gaps versus scope/acceptance criteria.

## Scope
- Persist `controllerEndpoint` metadata in session records for controller-backed sessions.
- Ensure `resume` keeps or refreshes binding for the same logical session key (no random key churn for resumed session).
- Ensure `prompt` uses persisted routing metadata when present (with deterministic fallback).
- Add real integration test coverage that demonstrates:
  - start/run session
  - prompt into that session
  - success acknowledgment and delivered input path
- Align task-3 validation evidence with actual command output and counts.

## Non-goals
- Do not implement remote API/proxy token handshake.
- Do not redesign CLI UX beyond what is required for correct session routing.

## Acceptance criteria
- Session records for controller-backed sessions include persisted `controllerEndpoint`.
- Resume path preserves/refreshes controller binding for the same session identity instead of generating unrelated keys.
- `airelay prompt <session> ...` resolves and uses correct endpoint routing for resumed/active sessions.
- Integration tests prove start/run + prompt + delivery path end-to-end (not only mocked socket unit tests).
- Existing run/resume/prompt behavior remains backward-compatible for non-controller sessions.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run resume sessions prompt`
- add at least one new E2E-style integration test that exercises real local controller socket flow

## Reporting Contract (Mandatory)
- Report file name MUST be exactly `tasks/deepseek_006_rework_task3_controller_binding_and_e2e_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` covering every criterion in this task with `pass|fail` and evidence.
- Report MUST include `## Validation Commands` with exit codes for every command listed in this task.
- Missing, renamed, out-of-order, or empty required sections make the task incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_006_rework_task3_controller_binding_and_e2e_report.md`
