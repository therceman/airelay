# Task 053: Redesign profile session persistence and restore model

## Objective
Fix session persistence semantics so restored profile sessions are based on harness-native session identity (`profileSessionId`) plus profile args, while airelay runtime `id` remains auto-generated and internal.

## Current Problems
- `sessions.json` currently stores `id` + `sessionKey` but does not persist a dedicated harness-native profile session id.
- Resume/start flows can rely on `id` in places where harness `profileSessionId` is required for correct restore behavior.
- `airelay start <profile> --key <k> -- <profile args>` should support resume args and persist enough metadata to reliably recreate the exact harness session linkage.

## Required Data Model
Per saved session entry, define and use:
1. `id`:
   - auto-generated internal airelay runtime id (never used as harness session id).
2. `sessionKey`:
   - user-facing key (optional override via `--key`; defaults generated).
3. `profileSessionId`:
   - harness-native session id for the profile (e.g. codex/opencode resume id), persisted for restore.
4. `profile`:
   - profile name.
5. `profileArgs`:
   - args used to launch/restore profile session (must include resume-relevant args when present).
6. Existing metadata retained: `cwd`, `lastUsed`, controller endpoint/pid as applicable.

## Behavioral Requirements
1. `airelay start codex2 --key gpt_master -- resume <id>`:
   - stores `profileSessionId=<id>`
   - stores `profileArgs` including `resume <id>` (or normalized equivalent)
   - runtime `id` remains internal/auto-generated.
2. Restore logic must use `profileSessionId` + `profileArgs` (not internal `id`) for harness resume.
3. Listing/output should continue to primarily reference `sessionKey`; internal id should not leak as harness session id.
4. Backward compatibility migration:
   - old entries without `profileSessionId` should be handled gracefully (derive when possible or mark non-resumable with actionable message).

## CLI/UX Requirements
- Keep `--key` semantics unchanged (user-set friendly key).
- Ensure start/resume wrapper behavior correctly separates airelay flags from profile args (`--` boundary).
- Error messages must explain missing `profileSessionId` and how to fix (restart/resave session).

## Tests (Mandatory)
Add/update tests for:
1. Session save includes internal `id` auto-generation and distinct `profileSessionId`.
2. Start with `-- resume <id>` persists expected `profileSessionId` and `profileArgs`.
3. Resume path uses `profileSessionId`/`profileArgs`, not internal `id`.
4. Backward-compat handling for legacy entries without `profileSessionId`.
5. CLI parsing correctness around `--key` + `--` profile args.

## Acceptance Criteria
- Data model includes and persists `profileSessionId` and `profileArgs` correctly.
- Restore behavior uses profile session metadata, not internal id.
- `npm test` exits `0`.
- `npm run verify` exits `0`.

## Report Process (Mandatory)
1. Copy `tasks/report_stub.md` to:
   - `tasks/todo/task_053_profile_session_persistence_and_restore_model_report_draft.md`
2. Fill all sections with concrete evidence and exit codes.
3. Rename to:
   - `tasks/todo/task_053_profile_session_persistence_and_restore_model_report.md`
4. Notify completion:
   - `airelay prompt gpt_master_airelay "task_053_done"`
