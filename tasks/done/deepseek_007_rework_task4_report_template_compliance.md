# Task

## ID
`deepseek_007_rework_task4_report_template_compliance`

## Agent
`DeepSeek`

## Execution Order
`7`

## File Ownership
- `tasks/deepseek_004_post_task_review_prompt_control_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Rewrite task 4 post-task review report to strict template compliance

## Scope
- Rewrite `tasks/deepseek_004_post_task_review_prompt_control_report.md` to exactly match `tasks/deepseek_post_task_review_template.md` required structure and format contract.
- Preserve existing substantive findings and evidence.
- Ensure findings are grouped under a single `## Findings` section with severity buckets `P0..P4`.
- Ensure each finding includes: `severity`, `file path`, `problem`, `impact`, `recommendation`.
- If a severity bucket has no findings, explicitly write `none`.
- Ensure `## Validation Commands` contains command + exit code lines.

## Non-goals
- Do not modify application code.
- Do not modify tests.
- Do not alter task implementation status beyond report normalization.

## Acceptance criteria
- Report follows exact required sections from `tasks/deepseek_post_task_review_template.md`.
- `## Findings` exists and is grouped by `P0..P4` with required fields for each finding.
- Validation command entries are present with exit codes.
- Missing/renamed/out-of-order/empty required sections are eliminated.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test`

## Reporting Contract (Mandatory)
- If any required section is missing, renamed, out of order, or empty, task is incomplete.
- Do not mark complete without strict compliance.

## Deliverables
- updated report at `tasks/deepseek_004_post_task_review_prompt_control_report.md`
- short completion note at `tasks/deepseek_007_rework_task4_report_template_compliance_report.md`
