# Task 060: Add `--no-warn` / `--nowarn` to suppress controller parity warnings

## Objective
Allow users to suppress non-fatal version parity warnings (e.g. controller older/newer) when running commands like `session-status --field state`.

## Required UX
- `airelay session-status <session> --field state --no-warn`
- `airelay session-status <session> --field state --nowarn`

Both flags must suppress warning lines such as:
`Warning: Controller (...) is older than CLI (...).`

## Scope
At minimum:
- `session-status` supports suppression.

Preferred consistency:
- Reuse same option for other controller-backed commands that emit parity warnings (`prompt`, `session-find`) if low risk.

## Implementation Requirements
1. CLI parsing:
   - Accept both `--no-warn` and `--nowarn` (same effect).
2. Command options:
   - Thread suppress-warnings option into relevant commands.
3. Behavior:
   - Errors must still be shown.
   - Only warnings are hidden.
4. Keep existing behavior unchanged when flag not set.

## Tests (Mandatory)
Add tests for:
1. Without flag, warning is printed when controller older/newer.
2. With `--no-warn`, warning is not printed.
3. With `--nowarn`, warning is not printed.
4. Errors are still printed even when no-warn is set.

## Acceptance Criteria
- User command from issue works without warning output:
  `airelay session-status deepseek_pro --field state --no-warn`
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_060_add_no_warn_flag_for_parity_warnings_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_060_add_no_warn_flag_for_parity_warnings_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_060_done"`
