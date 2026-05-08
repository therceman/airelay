# Task 059: Add `session-status --field <name>` selector output

## Objective
Add a machine-friendly way to fetch a single `session-status` field value, e.g. only `busy/free` state.

## Required UX
- `airelay session-status <session> --field state` -> prints only `busy` or `free`
- No labels, no extra text for field mode (plain value only)

## Scope
- CLI flag parsing for `session-status`
- command implementation in `sessionStatusCommand`
- tests for flag parsing + field output behavior

## Field Behavior
1. Allowed fields should map to `StatusResult` keys at minimum:
   - `sessionId`
   - `profile`
   - `sessionKey`
   - `controllerReachable`
   - `pingLatencyMs`
   - `airelayVersion`
   - `controllerProtocolVersion`
   - `startedAt`
   - `state`
2. Field mode output:
   - print only the raw value
   - booleans as `true/false`
   - numbers as numeric string
3. Errors:
   - unknown field => non-zero + actionable error listing allowed fields
   - missing value for known field => non-zero + clear message

## Compatibility
- Keep existing default formatted `session-status` output unchanged when `--field` not used.
- Keep `--json` behavior unchanged.

## Tests (Mandatory)
Add tests for:
1. `--field state` outputs only `busy/free`
2. unknown field fails with non-zero
3. missing field value fails with non-zero
4. default output unchanged when no `--field`
5. `--json` unchanged

## Acceptance Criteria
- `session-status --field state` works as described.
- Existing behaviors remain intact.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_059_add_session_status_field_selector_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_059_add_session_status_field_selector_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_059_done"`
