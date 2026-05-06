# Task

## ID
`deepseek_023_deep_review_perf_bottlenecks_and_duplication`

## Agent
`DeepSeek`

## Execution Order
`23`

## File Ownership
- `src/commands/*.ts`
- `src/controller/*.ts`
- `src/runtime/*.ts`
- `src/utils/*.ts`
- `test/*.test.ts`
- `README.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Deep review for performance bottlenecks and duplicate code

## Context
The current implementation is functionally complete, but we want a fresh deep review focused only on:
- performance bottlenecks
- duplicate code
- unnecessary complexity
- listener/resource lifecycle risks

This is a review-only task unless the review uncovers a small, clearly bounded cleanup that is required to support the report findings.

## Scope
- Inspect the current codebase for duplicate logic that should be extracted.
- Inspect the current codebase for hot-path or lifecycle performance risks.
- Inspect the current codebase for listener/resource leaks or repeated work.
- Produce concrete findings with file references and severity.
- Do not modify unrelated behavior unless a narrowly scoped fix is needed for the review.

## Non-goals
- Do not redesign the architecture.
- Do not add new features.
- Do not change CLI semantics unless a defect is discovered and fixed in-place.

## Acceptance criteria
- Report lists concrete duplicate-code findings or explicitly states none.
- Report lists concrete performance bottlenecks or explicitly states none.
- Report includes file references and actionable recommendations.
- Existing tests remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- run resume prompt spawn controller sessions`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/post_review_report_stub.md tasks/deepseek_023_deep_review_perf_bottlenecks_and_duplication_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_023_deep_review_perf_bottlenecks_and_duplication_report.md`.
- Report MUST follow exact headings and order from `tasks/deepseek_post_task_review_template.md`.
- Report MUST include a `## Findings` section with severity-ordered bullets.
- Report MUST include validation command exit codes for all listed commands.
- Report MUST include a duplicate/performance review section with concrete findings and recommendations.

## Deliverables
- report at `tasks/deepseek_023_deep_review_perf_bottlenecks_and_duplication_report.md`
