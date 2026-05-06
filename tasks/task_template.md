# Task Template

## ID
`<agent>_XXX_<slug>`

## Agent
`DeepSeek`

## Execution Order
`<number in batch>`

## File Ownership
- `<path 1>`
- `<path 2>`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
<short title>

## Scope
- 

## Non-goals
- 

## Acceptance criteria
- 

## Validation
- `npm run -s build`
- `npm run -s lint`
- add task-specific checks

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/<task_file_basename>_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/<task_file_basename>_report_draft.md tasks/<task_file_basename>_report.md`
- The final report file name MUST be exactly `tasks/<task_file_basename>_report.md`.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- The report MUST use exact section headings/order from `tasks/report_stub.md`.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence (file paths, test names, command output snippets).
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "<task_id>_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.
- Do not mark the task complete without the report.

## Deliverables
- code changes
- report at `tasks/<task_file_basename>_report.md`
