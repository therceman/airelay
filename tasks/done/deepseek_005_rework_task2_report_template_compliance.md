# Task

## ID
`deepseek_005_rework_task2_report_template_compliance`

## Agent
`DeepSeek`

## Execution Order
`5`

## File Ownership
- `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Rewrite task 2 report to strict template compliance

## Scope
- Rewrite `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md` to exactly match `tasks/task_report_template.md` headings and order.
- Preserve factual implementation details from existing report.
- Add explicit acceptance-criteria mapping with concrete evidence.
- Include command exit codes in `## Validation Commands`.
- Fill all mandatory sections; if a section has no items, write `none` as required.

## Non-goals
- Do not change application code.
- Do not change tests.
- Do not modify task 2 implementation files.

## Acceptance criteria
- Report uses exact section headings from `tasks/task_report_template.md` in exact order.
- `## Acceptance Criteria Mapping` exists and maps every criterion from task 2 with `pass|fail` plus evidence.
- `## Runtime/IPC Validation (if applicable)` includes concrete transcript snippets or explicit `none` justification.
- `## Duplicate/Performance Review`, `## Risks and Follow-ups`, and `## Roadmap Recommendations` are present and non-empty (`none` allowed where applicable).

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli prompt`

## Reporting Contract (Mandatory)
- If any required section is missing, renamed, out of order, or empty, task is incomplete.
- Do not mark complete without strict compliance.

## Deliverables
- updated report at `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md`
- short completion note in `tasks/deepseek_005_rework_task2_report_template_compliance_report.md`
