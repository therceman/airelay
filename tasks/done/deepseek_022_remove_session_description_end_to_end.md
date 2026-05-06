# Task

## ID
`deepseek_022_remove_session_description_end_to_end`

## Agent
`DeepSeek`

## Execution Order
`22`

## File Ownership
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts`
- `src/commands/select.ts`
- `src/commands/run.ts`
- `src/commands/resume.ts`
- `test/sessions*.test.ts`
- `test/sessions-list.test.ts`
- `test/select*.test.ts`
- `test/run.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Remove session description end-to-end

## Context
We do not need the session `description` field anymore. It currently remains in session storage, interactive save flow, and JSON output even after the human-readable session list was simplified. This task removes it fully so sessions only track the fields we actually use.

## Scope
- Remove `description` from session save/load/update behavior where practical.
- Remove the interactive "Session description (optional)" prompt from the selector flow.
- Remove `description` from session JSON output and related type definitions if no longer needed.
- Update session-related tests to reflect the simplified schema and outputs.
- Preserve prompt control, session keys, controller endpoints, and cwd behavior.

## Non-goals
- Do not change controller IPC behavior.
- Do not change session key generation or lookup semantics.
- Do not change prompt submission behavior.

## Acceptance criteria
- New sessions no longer ask for or store a description.
- Session records and JSON output no longer include `description`.
- Existing prompt/control behavior remains intact.
- Tests remain green and cover the simplified session schema/output.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- sessions-list sessions select run resume`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_022_remove_session_description_end_to_end_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_022_remove_session_description_end_to_end_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.
- Report MUST describe any schema or compatibility tradeoffs explicitly.

## Deliverables
- code changes
- report at `tasks/deepseek_022_remove_session_description_end_to_end_report.md`
