# Task

## ID
`deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree`

## Agent
`DeepSeek`

## Execution Order
`25`

## File Ownership
- `src/commands/init.ts`
- `src/commands/create-interactive.ts`
- `src/commands/isolate.ts`
- `src/commands/remove.ts`
- `src/utils/harness-isolation.ts`
- `src/utils/harness-isolate.ts`
- `src/config/migrate.ts`
- `test/harness-isolate*.test.ts`
- `test/init.test.ts`
- `test/create*.test.ts`
- `test/remove.test.ts`

## Shared File Risk Check (Mandatory)
- `src/config/migrate.ts` — exclusive
- `src/utils/harness-isolation.ts` — exclusive
- `src/utils/harness-isolate.ts` — exclusive
- `src/commands/init.ts` — exclusive
- `src/commands/create-interactive.ts` — exclusive
- `src/commands/isolate.ts` — exclusive
- `src/commands/remove.ts` — exclusive
- `test/harness-isolate*.test.ts` — exclusive
- `test/init.test.ts` — exclusive
- `test/create*.test.ts` — exclusive
- `test/remove.test.ts` — exclusive

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Audit Codex home migration and legacy `.aiswitch` symlink tree

## Context
The user observed that `.aiswitch/codex-codex2` still contains symlinks and `auth.json` remnants after the rename to `.airelay`. This may indicate that legacy Codex home data and symlink trees are still being used or migrated incorrectly. The goal is to audit the Codex home creation/migration logic and verify whether the rename path is leaving behind stale state that breaks session reuse/resume expectations.

## Scope
- Audit how Codex profiles are created in `init.ts` and `create-interactive.ts`.
- Verify how `CODEX_HOME` is set, whether it points to shared `.codex` content or profile-specific isolated trees.
- Inspect `migrate.ts` for any rename/copy behavior that preserves legacy `.aiswitch` structures in a way that conflicts with the desired shared overlay model.
- Confirm whether the symlink tree in legacy `.aiswitch/codex-<profile>` is expected or stale.
- If needed, fix the migration or profile setup so Codex profiles use the intended shared `.codex` layout with only `auth.json` isolated.
- Update tests to cover the migration/creation behavior.

## Non-goals
- Do not redesign Codex auth.
- Do not add new harnesses.
- Do not change prompt/control semantics.

## Acceptance criteria
- The report explains why `.aiswitch/codex-codex2` still exists or confirms it is stale and should not be used.
- Codex profile creation paths are consistent with the intended shared `.codex` + isolated `auth.json` model.
- Any migration behavior that leaves stale legacy state is fixed or explicitly justified.
- Tests remain green and cover the relevant migration/setup behavior.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- harness-isolate init create remove`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree_report_draft.md tasks/deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree_report.md`
- The final report file name MUST be exactly `tasks/deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree_report.md`.
- The report MUST use exact section headings from `tasks/task_report_template.md` (same text, same order).
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence.
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree_report.md`
