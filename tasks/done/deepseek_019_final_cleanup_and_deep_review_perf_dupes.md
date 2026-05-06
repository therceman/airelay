# Task

## ID
`deepseek_019_final_cleanup_and_deep_review_perf_dupes`

## Agent
`DeepSeek`

## Execution Order
`19`

## File Ownership
- `src/runtime/spawn.ts`
- `src/runtime/pty.ts`
- `src/cli.ts`
- `README.md`
- `tasks/deepseek_017_post_pty_migration_review_report.md` (only if report normalization is needed)
- `test/spawn*.test.ts`
- `test/cli*.test.ts`
- `test/cli-integration.test.ts`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Final cleanup: PTY lifecycle hardening, docs consistency, and deep duplicate/performance review

## Context
Previous PTY migration tasks are functionally complete, but a few cleanup items and documentation inconsistencies remain. This task should finish the implementation cleanup and also perform a deeper duplicate/performance review of the final architecture.

## Scope
- Add SIGINT/SIGTERM forwarding to the PTY-backed spawn path if still missing.
- Ensure PTY resize forwarding and listener cleanup remain correct and complete.
- Remove dead/unused spawn options and callbacks from the PTY/cross-spawn interface if they are truly unused.
- Update README/CLI text so launch behavior and usage are consistent with the final contract.
- Perform a deep review focused on:
  - duplicate code
  - unnecessary complexity
  - performance risks
  - resource/listener lifecycle leaks

## Non-goals
- Do not add remote/proxy network API.
- Do not redesign the command surface beyond consistency cleanup.
- Do not change session schema unless required by cleanup.

## Acceptance criteria
- PTY lifecycle is complete and signal-safe.
- CLI/README usage matches the actual supported launch flow.
- Dead code / unused options cleaned up where practical.
- Report includes a deep review of duplicate code and performance risks with concrete findings.
- Existing tests remain green; any new cleanup behavior is covered.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli start run resume prompt spawn runtime`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub:
  - `cp tasks/report_stub.md tasks/deepseek_019_final_cleanup_and_deep_review_perf_dupes_report.md`
- Fill that copied file only; do not create a custom report structure.
- Report file name MUST be exactly `tasks/deepseek_019_final_cleanup_and_deep_review_perf_dupes_report.md`.
- Report MUST follow exact headings and order from `tasks/task_report_template.md`.
- Report MUST include `## Acceptance Criteria Mapping` with pass/fail + evidence for each criterion.
- Report MUST include validation command exit codes for all listed commands.
- Report MUST include a dedicated duplicate/performance review section with concrete findings and recommendations.

## Deliverables
- code changes
- report at `tasks/deepseek_019_final_cleanup_and_deep_review_perf_dupes_report.md`
