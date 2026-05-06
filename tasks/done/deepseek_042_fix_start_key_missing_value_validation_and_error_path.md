# Task: Fix `start --key` Missing-Value Validation + Remove Legacy Session Name Residue

## Task ID
`deepseek_042_fix_start_key_missing_value_validation_and_error_path`

## Context
Two remaining issues:
1. Parser can set `flags.key = true` when `--key` has no value (e.g. `airelay start opencode2 --key -- ...`), causing non-actionable failures.
2. Legacy `name` session identity residue remains (schema/helpers), despite key-based identity migration.

Need both fixed in one follow-up.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_042_fix_start_key_missing_value_validation_and_error_path_report_draft.md`
2. Complete with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_042_fix_start_key_missing_value_validation_and_error_path_report_draft.md tasks/deepseek_042_fix_start_key_missing_value_validation_and_error_path_report.md`

## Scope
### A) `--key` missing value path
1. Ensure `--key` requires a value for `start` command.
2. Emit actionable error:
- `Error: --key requires a value.`
3. Prevent runtime type crash paths (`trim` on boolean etc.).
4. Add tests:
- `start <profile> --key -- ...` (missing value)
- `start <profile> --key` end-of-args
- valid `--key` still works

### B) P2 cleanup: remove legacy `name` identity residue
1. Remove session `name` from active identity/display flow.
2. Remove unused name-specific helpers from `sessions.ts` if no longer needed:
- `renameSession`
- `getSessionDisplayName`
3. Keep backward compatibility for loading existing records (do not break old `sessions.json`), but do not use `name` for identity/rendering.
4. Update tests accordingly.

## Primary file ownership
- `src/cli.ts`
- `src/commands/sessions.ts`
- `src/commands/sessions-list.ts` (only if needed for cleanup alignment)
- `test/cli-runCli.test.ts`
- `test/sessions.test.ts`

## Acceptance criteria
1. Missing key value yields clean error + exit 1.
2. No type crash path remains.
3. Valid key path unchanged.
4. Legacy `name` is no longer used for session identity/display flow.
5. Removed name-only helpers are not referenced anywhere.
6. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli-runCli sessions sessions-list`
- `npm test`

Record exits in report.

## Report requirements
- Final report path:
`tasks/deepseek_042_fix_start_key_missing_value_validation_and_error_path_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include acceptance mapping with concrete evidence.

## Constraints
- Minimal/surgical patch.
- No unrelated behavior changes.
