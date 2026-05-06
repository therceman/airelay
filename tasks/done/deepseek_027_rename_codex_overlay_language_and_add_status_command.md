# Task

## ID
`deepseek_027_rename_codex_overlay_language_and_add_status_command`

## Agent
`DeepSeek`

## Execution Order
`27`

## File Ownership
- `src/commands/create-interactive.ts`
- `src/commands/init.ts`
- `src/commands/isolate.ts`
- `src/commands/remove.ts`
- `src/commands/sessions-list.ts`
- `src/commands/cli.ts`
- `src/utils/harness-isolation.ts`
- `src/utils/harness-isolate.ts`
- `test/create*.test.ts`
- `test/init.test.ts`
- `test/isolate*.test.ts`
- `test/remove.test.ts`

## Shared File Risk Check (Mandatory)
- `src/commands/create-interactive.ts` — exclusive
- `src/commands/init.ts` — exclusive
- `src/commands/isolate.ts` — exclusive
- `src/commands/remove.ts` — exclusive
- `src/commands/sessions-list.ts` — exclusive if status command uses it
- `src/commands/cli.ts` — exclusive if command wiring changes
- `src/utils/harness-isolation.ts` — exclusive
- `src/utils/harness-isolate.ts` — exclusive
- `test/create*.test.ts` — exclusive
- `test/init.test.ts` — exclusive
- `test/isolate*.test.ts` — exclusive
- `test/remove.test.ts` — exclusive

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Rename Codex overlay language and add an explicit status/inspection command

## Context
The current wording says Codex profiles are “isolated” when in reality they are shared-base overlays:
- shared state comes from `~/.codex`
- only `auth.json` is local

That wording is confusing and is leading to incorrect assumptions about resume/shared-state behavior. We need clearer terminology in user-facing output and a way to inspect the overlay layout explicitly.

## Scope
- Replace misleading “isolated Codex home/profile” wording with “overlay”, “shared-base”, or similarly accurate terminology.
- Ensure the Codex creation/init/isolate/remove commands clearly explain that Codex profiles share `~/.codex` and keep `auth.json` local.
- Add or adjust a status command that shows the Codex overlay/shared-layout details clearly.
- Update tests for the wording/command output.

## Non-goals
- Do not change the actual overlay behavior.
- Do not redesign Codex auth.
- Do not alter prompt/resume semantics.

## Acceptance criteria
- User-facing Codex messages no longer imply full isolation when the layout is a shared-base overlay.
- A command exists or is updated to clearly display the Codex overlay/shared layout.
- Tests cover the new wording/output.
- Existing behavior remains unchanged.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm test -- create init isolate remove`
- `npm test`

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/deepseek_027_rename_codex_overlay_language_and_add_status_command_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/deepseek_027_rename_codex_overlay_language_and_add_status_command_report_draft.md tasks/deepseek_027_rename_codex_overlay_language_and_add_status_command_report.md`
- The final report file name MUST be exactly `tasks/deepseek_027_rename_codex_overlay_language_and_add_status_command_report.md`.
- The report MUST use exact section headings from `tasks/task_report_template.md` (same text, same order).
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped in the report with explicit status (`pass`/`fail`) and supporting evidence.
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- code changes
- report at `tasks/deepseek_027_rename_codex_overlay_language_and_add_status_command_report.md`
