# Task 046: Fix controller E2E prompt-prefix assertion failures

## Objective
Restore green pre-commit verification by fixing `test/controller-e2e.test.ts` expectations that currently fail after sender-prefix behavior was introduced in prompt injection.

## Context
Current failure from `npm test` / pre-commit:
- Expected: `Hello E2E`
- Received: `[from=gpt_master_airelay] Hello E2E`
- Expected: `submit this`
- Received: `[from=gpt_master_airelay] submit this`

Behavior change is intentional (automatic sender metadata prefix), so tests should validate the new behavior instead of forcing legacy raw-text expectations.

## Scope
- Update E2E tests to assert the correct prompt payload semantics under sender-prefix behavior.
- Keep coverage for Enter/CR behavior intact.
- Ensure assertions are robust (not brittle to unrelated formatting noise).

## Files
- Primary: `test/controller-e2e.test.ts`
- Optional (only if truly needed): related prompt/session test helpers.

## Requirements
1. Fix failing assertions in `controller-e2e` tests to match current intended behavior.
2. Preserve existing behavior checks (successful delivery, enter semantics).
3. No product-behavior regressions from test-only patching.
4. Run and report:
   - `npm test`
   - `npm run verify`

## Acceptance Criteria
- `npm test` exits `0`.
- `npm run verify` exits `0`.
- Report clearly explains what assertion logic changed and why.

## Report Instructions (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_046_fix_controller_e2e_prompt_prefix_assertions_report_draft.md`
2. Fill all sections with concrete evidence.
3. When fully complete, rename to:
   - `tasks/todo/task_046_fix_controller_e2e_prompt_prefix_assertions_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_046_done"`

## Constraints
- Do not change report structure.
- Do not leave empty sections.
- Do not claim success without command outputs + exit codes.
