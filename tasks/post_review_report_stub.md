# DeepSeek Post-Task Review

## ID
`deepseek_XXX_<review_slug>`

## Agent
DeepSeek

## Execution Order
`<number>`

## File Ownership
- `tasks/<task_file_basename>_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Post-task deep code review for `<completed_task_id>`

## Context
Review scope and what was verified.

## Scope
- Verify report vs code.
- Validate acceptance criteria evidence.
- Review correctness/regressions/dup/perf/test gaps.

## Non-goals
- No code changes unless explicitly assigned.

## Task ID
`<completed_task_id>`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test` -> `0`

## Executive summary
Short final assessment.

## Findings

### P0
none

### P1
none

### P2
- **severity**: P2
- **file path**: `src/example.ts:42`
- **problem**: ...
- **impact**: ...
- **recommendation**: ...

### P3
none

### P4
none

## Duplicate-code Findings
- none

## Performance-risk Findings
- none

## Test/validation Gap Findings
- none

## Required Follow-up Tasks
1. `deepseek_YYY_<slug>` — reason, ownership.

## Completion Rule
- P0/P1 block completion.
- P2 requires follow-up task or explicit acceptance.

## Deliverables
- report at `tasks/<task_file_basename>_report.md`
