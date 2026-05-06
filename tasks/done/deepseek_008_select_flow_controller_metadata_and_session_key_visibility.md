# Task

## ID
`deepseek_008_select_flow_controller_metadata_and_session_key_visibility`

## Agent
`DeepSeek`

## Execution Order
`8`

## File Ownership
- `src/commands/select.ts`
- `src/commands/run.ts` (only if needed for returning controller/session metadata to caller)
- `src/commands/sessions.ts` (only if helper adjustment is needed)
- `test/select*.test.ts`
- `test/run*.test.ts` (only if required for new metadata contract)

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Close P2 gaps in select flow: persist controller endpoint and expose session key

## Context
Post-task review identified two blocking P2 issues for practical prompt usability from TUI/select flow.

## Scope
- Ensure sessions saved from `select.ts` include `controllerEndpoint` metadata when controller-backed runtime is used.
- Ensure generated/active `sessionKey` is shown to user in select flow when starting a session.
- Keep UX simple: one concise message that includes session key and prompt usage hint.
- Preserve current `start`/`resume` behavior and compatibility.
- Add tests that prove:
  - select flow save path persists `controllerEndpoint`
  - select flow surfaces `sessionKey` text output

## Non-goals
- Do not redesign select/TUI interaction model.
- Do not add proxy/remote API integration.
- Do not address P3/P4 follow-ups in this task.

## Acceptance criteria
- `select.ts`-saved sessions include `controllerEndpoint` for controller-backed runs.
- User can see the `sessionKey` after starting from select flow.
- Tests cover the new persistence and output behavior.
- Existing tests remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- select run sessions prompt`

## Reporting Contract (Mandatory)
- Start by copying the stub exactly:
  - `cp tasks/report_stub.md tasks/deepseek_008_select_flow_controller_metadata_and_session_key_visibility_report.md`
- Fill that copied file only; do not create a custom structure from scratch.
- Report file name MUST be exactly `tasks/deepseek_008_select_flow_controller_metadata_and_session_key_visibility_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.

## Deliverables
- code changes
- report at `tasks/deepseek_008_select_flow_controller_metadata_and_session_key_visibility_report.md`
