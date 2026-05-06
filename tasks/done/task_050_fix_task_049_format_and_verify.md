# Task 050: Fix task 049 formatting and pass verify

## Objective
Apply formatting fixes required by Prettier for task 049 changes and ensure full verification passes.

## Failure Context
`npm run verify` failed on `format:check` with warnings:
- `src/commands/session-viewport.ts`
- `src/controller/protocol.ts`
- `src/types/controller.ts`

## Required Actions
1. Apply formatting fixes (Prettier-compliant) to the listed files.
2. Re-run:
   - `npm run format:check`
   - `npm test`
   - `npm run verify`
3. Ensure no functional regressions in viewport implementation.

## Acceptance Criteria
- `npm run format:check` exits `0`.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_050_fix_task_049_format_and_verify_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_050_fix_task_049_format_and_verify_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_050_done"`
