# Task

## ID
`deepseek_026_add_codex_profile_overlay_repair_flow`

## Agent
`DeepSeek`

## Execution Order
`26`

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
Add a repeatable Codex profile overlay repair flow

## Context
We manually repaired `~/.airelay/codex-codex2` by preserving `auth.json` and recreating the shared symlink overlay from `~/.codex`. That confirms the intended layout, but the repo lacks a first-class way to repair or rebuild an existing Codex profile directory after migration drift or stale legacy state. The goal is to make the Codex overlay setup repeatable and safe.

## Scope
- Add or adjust a repair flow that can rebuild a Codex profile overlay from shared `~/.codex` content while preserving the local `auth.json`.
- Ensure existing Codex profile setup paths can repair stale or partially populated `.airelay/codex-<name>` trees without deleting auth.
- Keep the intended isolation model:
  - shared `.codex` data via symlinks
  - isolated `auth.json`
- Update tests so the repair/rebuild behavior is exercised explicitly.
- Make sure the flow is safe when `.aiswitch` legacy state still exists or when the profile directory already exists.

## Non-goals
- Do not change Codex auth semantics.
- Do not add remote sync/proxy features.
- Do not change prompt/resume behavior.

## Acceptance criteria
- A Codex profile overlay can be rebuilt or repaired without losing `auth.json`.
- Shared items are re-symlinked from `~/.codex` as needed.
- Existing `CODEX_HOME` layout for codex profiles remains consistent with the intended shared-overlay model.
- Tests cover the repair/rebuild path and remain green.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- harness-isolate init create remove`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/deepseek_026_add_codex_profile_overlay_repair_flow_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/deepseek_026_add_codex_profile_overlay_repair_flow_report_draft.md tasks/deepseek_026_add_codex_profile_overlay_repair_flow_report.md`
- The final report file name MUST be exactly `tasks/deepseek_026_add_codex_profile_overlay_repair_flow_report.md`.
- The report MUST use exact section headings from `tasks/task_report_template.md` (same text, same order).
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence.
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_026_add_codex_profile_overlay_repair_flow_report.md`
