# Task Report

## Task ID
`deepseek_024_cleanup_dead_spawn_paths_and_deduplicate_json_persistence`

## Summary
- Removed `spawnProcess` function (~20 lines) from `src/runtime/spawn.ts` — dead code with no callers
- Removed `SpawnResult` interface from `src/runtime/spawn.ts` — unused alongside `spawnProcess`
- Removed the dead `childStdin` write path from `src/commands/run.ts` — `setupController` now only checks `ptyWrite` before throwing the prompt-unavailable error; the `childStdin` branch could never succeed with `stdio: 'inherit'`
- Extracted shared JSON persistence utility (`src/utils/json-store.ts`) used by both `sessions.ts` and `pid.ts`, eliminating ~30 lines of duplicated load/save/getPath logic
- Renamed misleading variable `shortId` → `truncatedId` in `getSessionDisplayName`

## Files Changed
Modified:
- `src/runtime/spawn.ts` — removed `spawnProcess` function and `SpawnResult` interface (both dead code); kept `spawnChild`, `spawnAndWait`, and `spawnAndWaitPty` unchanged
- `src/commands/run.ts` — removed `childStdinRef` wrapper, `childStdin` parameter from `setupController`, and the dead `childStdin.current` write branch; `setupController` now takes `(sessionKey, ptyWrite)` only; controller handler checks `ptyWrite` then throws
- `src/commands/sessions.ts` — replaced inline `loadSessions`/`saveSessions`/`getSessionsPath` with shared `createJsonStore<SessionsData>()`; renamed `shortId` → `truncatedId` in `getSessionDisplayName`
- `src/utils/pid.ts` — replaced inline `loadPIDs`/`savePIDs`/`getPIDPath` with shared `createJsonStore<PIDData>()`

New:
- `src/utils/json-store.ts` — `createJsonStore<T>({ envVar, defaultPath, migrate })` factory returning `{ load, save, getPath }`; handles env-var override, file read/write, directory creation, and silent error recovery

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- spawn run sessions` -> `0` (67/67 passed across 5 suites)
- `npm test` -> `0` (223/223 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — cleanup of dead code and persistence extraction; no runtime/IPC behavior changed

## Duplicate/Performance Review
- duplicate code findings: JSON persistence pattern between sessions and PIDs resolved by shared `createJsonStore` utility (~30 lines eliminated)
- hot-path/performance findings: none — all operations are per-invocation, within acceptable ranges
- proposed refactors: none

## Acceptance Criteria Mapping
- `spawnProcess is removed or clearly justified as retained with tests and deprecation notes` -> pass; evidence: `src/runtime/spawn.ts` no longer contains `spawnProcess`; `grep` confirms zero imports of `spawnProcess` or `SpawnResult` across the codebase; all tests pass without it
- `childStdin dead path is removed or justified with a live call site` -> pass; evidence: `src/commands/run.ts` `setupController` now takes `(sessionKey, ptyWrite)` only; the `childStdin` parameter, wrapper, and write branch are eliminated; controller handler checks `ptyWrite` then immediately throws; all tests pass
- `Shared JSON persistence duplication is reduced where practical` -> pass; evidence: `src/utils/json-store.ts` provides `createJsonStore<T>()`; `src/commands/sessions.ts` and `src/utils/pid.ts` both use it instead of inline load/save/getPath functions; ~30 lines of duplication removed
- `Tests remain green` -> pass; evidence: full suite 223/223 passes (no test changes needed — all refactored APIs are internal)

## Risks and Follow-ups
- none — all changes are internal refactoring with no behavioral impact

## Roadmap Recommendations
- none — task 24 is complete
