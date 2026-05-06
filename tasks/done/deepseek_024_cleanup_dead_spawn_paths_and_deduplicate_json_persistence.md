# Task

## ID
`deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence`

## Agent
`DeepSeek`

## Execution Order
`24`

## File Ownership
- `src/runtime/spawn.ts`
- `src/commands/run.ts`
- `src/utils/json-store.ts` (if introduced)
- `src/commands/sessions.ts`
- `src/utils/pid.ts`
- `test/spawn*.test.ts`
- `test/run.test.ts`
- `test/sessions*.test.ts`

## Shared File Risk Check (Mandatory)
- `src/runtime/spawn.ts` — exclusive
- `src/commands/run.ts` — exclusive
- `src/commands/sessions.ts` — exclusive
- `src/utils/pid.ts` — exclusive
- `src/utils/json-store.ts` — exclusive if introduced
- `test/spawn*.test.ts` — exclusive
- `test/run.test.ts` — exclusive
- `test/sessions*.test.ts` — exclusive

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Clean up dead spawn paths and deduplicate JSON persistence

## Context
A post-task deep review identified a few low-risk cleanup items:
- `spawnProcess` in `src/runtime/spawn.ts` is dead code.
- The `childStdin` write path in `src/commands/run.ts` is dead in practice.
- JSON persistence logic is duplicated between session storage and PID storage.
- There are a few minor P4 cleanup items, but no performance bottleneck.

This task should clean up the P2 items and, if practical, extract shared JSON persistence helpers to reduce duplication.

## Scope
- Remove `spawnProcess` if no code paths use it.
- Remove the dead `childStdin` write branch from `run.ts` if PTY-only prompt injection is now the only supported prompt path.
- Extract a shared JSON persistence utility if it can be done cleanly without disturbing behavior.
- Keep behavior, validation, and prompt/session control intact.
- Update tests to reflect the cleanup and ensure all suites remain green.

## Non-goals
- Do not change prompt semantics.
- Do not redesign PTY/controller architecture.
- Do not change CLI surface area unless the cleanup requires a small doc tweak.

## Acceptance criteria
- `spawnProcess` is removed or clearly justified as retained with tests and deprecation notes.
- `childStdin` dead path is removed or justified with a live call site.
- Shared JSON persistence duplication is reduced where practical.
- Tests remain green.
- Report includes a brief deep-review note on any remaining P4 cleanup items.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- spawn run sessions`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence_report_draft.md tasks/deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence_report.md`
- The final report file name MUST be exactly `tasks/deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence_report.md`.
- The report MUST use exact section headings from `tasks/task_report_template.md` (same text, same order).
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence.
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence_report.md`
