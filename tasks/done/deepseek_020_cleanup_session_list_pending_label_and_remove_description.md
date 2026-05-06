# Task

## ID
`deepseek_020_cleanup_session_list_pending_label_and_remove_description`

## Agent
`DeepSeek`

## Execution Order
`20`

## File Ownership
- `src/commands/run.ts`
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts`
- `src/commands/select.ts`
- `src/commands/resume.ts`
- `test/sessions*.test.ts`
- `test/run.test.ts`
- `test/select*.test.ts`
- `test/resume.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Cleanup session list presentation: remove `pending_` label and session descriptions

## Context
The current session list shows placeholder-looking IDs like `pending_opencode2_xxxx` and a generic description such as `Controller-backed session for opencode2`. This is confusing for users and adds a field we no longer need.

## Scope
- Change new session records so they no longer display or store the `pending_` prefix as the user-facing session label.
- Remove the generic session `description` field from the session list output and from new-session creation where practical.
- Keep the functional controller/session-key mapping intact for prompt control.
- Update tests and any related command output to reflect the simplified presentation.

## Non-goals
- Do not change controller IPC behavior.
- Do not change prompt routing or session key lookup semantics.
- Do not redesign the session schema beyond this cleanup.

## Acceptance criteria
- Session listings no longer show `pending_...` as the user-facing session label.
- Session listings no longer print the generic controller-backed description.
- Prompt/control behavior still works for existing sessions.
- Tests remain green and cover the cleaned-up output.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- sessions run select resume`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_020_cleanup_session_list_pending_label_and_remove_description_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_020_cleanup_session_list_pending_label_and_remove_description_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.
- Report MUST describe any session-schema or output-format compatibility tradeoffs.

## Deliverables
- code changes
- report at `tasks/deepseek_020_cleanup_session_list_pending_label_and_remove_description_report.md`
