# Task 057: Rework task 053 — true internal id + profileSession restore contract

## Why task 053 is not accepted
Current implementation still violates core requirements:
1. `id` is still effectively `sessionKey` (not a distinct auto-generated internal runtime id).
2. Restore fallback still uses internal `id` in places.
3. Model separation (`id` vs `sessionKey` vs `profileSessionId`) is incomplete.

## Required Model (strict)
Per session entry:
- `id`: auto-generated internal runtime id (opaque; not harness id; not equal to sessionKey by default)
- `sessionKey`: user key (`--key` override or generated key)
- `profileSessionId`: harness-native session id used for harness restore/resume
- `profileArgs`: exact profile args used for restore context

## Required Implementation Changes
1. Generate true internal runtime id (e.g., `runtime_<...>` or UUID) at session creation.
2. Persist session entry with distinct `id` and `sessionKey`.
3. Ensure all restore flows (`resume.ts`, `select.ts`, wrappers) use `profileSessionId` + `profileArgs` when available.
4. Legacy fallback may use old behavior only when metadata missing, with explicit warning.
5. Ensure list/output remains sessionKey-centric for user interaction.

## Required Behavior Example
`airelay start codex2 --key gpt_master -- resume 019db97c-...`
must persist:
- `id`: internal generated id (not gpt_master)
- `sessionKey`: `gpt_master`
- `profileSessionId`: `019db97c-...`
- `profileArgs`: `["resume", "019db97c-..."]`

## Tests (Mandatory)
Add/adjust tests for:
1. `id` auto-generated and distinct from `sessionKey`.
2. `--key` persists to `sessionKey` only.
3. Resume uses `profileSessionId`/`profileArgs` not internal `id`.
4. Legacy entry fallback with warning.
5. CLI parse around `--key` + `--` still correct.

## Acceptance Criteria
- Distinct internal `id` is implemented and persisted.
- Restore uses profile metadata contract.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_057_rework_task_053_true_internal_id_and_profile_session_restore_report_draft.md`
2. Fill all sections with concrete evidence + exit codes.
3. Rename to:
   - `tasks/todo/task_057_rework_task_053_true_internal_id_and_profile_session_restore_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_057_done"`
