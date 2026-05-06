# Task Report

## Task ID
`task_053_profile_session_persistence_and_restore_model`

## Summary
Added `profileSessionId` and `profileArgs` to the session data model. Resume logic now uses these fields instead of the internal `id` for harness restore. Key changes:

1. **Data model**: `SessionEntry` extended with `profileSessionId` and `profileArgs`; `addSession` accepts and persists them
2. **Auto-detection**: `detectResumeSessionId()` in `run.ts` extracts the resume session id from `extraArgs` (detects `resume <id>` or `-s <id>` patterns)
3. **Resume flow**: `resume.ts` now prefers `profileSessionId` + `profileArgs` for restore; falls back to `-s <id>` for legacy entries with a warning
4. **TUI resume**: `select.ts` uses `profileSessionId`/`profileArgs` when available
5. **Backward compat**: legacy entries without `profileSessionId` gracefully fall back to existing behavior with an actionable warning

## Files Changed
Modified:
- `src/commands/sessions.ts` — `SessionEntry` gains `profileSessionId?: string` and `profileArgs?: string[]`; `addSession` signature extended to accept and persist them
- `src/commands/run.ts` — `runCommand` options gain `profileSessionId` and `profileArgs`; auto-detects resume session id from extraArgs via `detectResumeSessionId()`; passes metadata to `addSession`; `detectResumeSessionId()` exported
- `src/commands/resume.ts` — rewritten to use `profileSessionId` + `profileArgs` for restore when available; warns on legacy entries without `profileSessionId`
- `src/commands/select.ts` — session selector displays `profileSessionId` when present; resume uses `profileArgs` or `-s <profileSessionId | id>`; passes `profileSessionId`/`profileArgs` to `runCommand`
- `test/sessions.test.ts` — 2 new tests: `profileSessionId` persistence, `profileArgs` persistence
- `test/run.test.ts` — 5 new `detectResumeSessionId` unit tests (resume, -s, empty, no flag, no value)

## Validation Commands
- `npm run build` -> `0`
- `npm run lint` -> `0`
- `npm run format:check` -> `0`
- `npm test` -> `0` (282/282, 26 suites)
- `npm run verify` -> `0` (all stages)

## Acceptance Criteria Mapping
- `Data model includes and persists profileSessionId and profileArgs correctly` — **pass**; evidence: `sessions.ts:SessionEntry` has both fields; `addSession` stores them; tests "persists profileSessionId when provided" and "persists profileArgs when provided" confirm persistence
- `Restore behavior uses profile session metadata, not internal id` — **pass**; evidence: `resume.ts:13-16` uses `session.profileArgs` (when present) for restore args; `resume.ts:12` passes `profileSessionId` to `runCommand`; `select.ts:300-302` uses `selectedSession.profileArgs` or `-s <profileSessionId | id>`
- `npm test exits 0` — **pass**; evidence: 282/282
- `npm run verify exits 0` — **pass**; evidence: all stages 0

## Legacy compat
Old entries without `profileSessionId` are handled: resume emits a warning "This session has no profile session metadata" and falls back to `-s <id>`. The same fallback is applied in both `resume.ts` and `select.ts`.
