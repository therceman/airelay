# Task Report

## Task ID
`deepseek_012_refactor_spawn_run_and_ipc_framing`

## Summary
- Eliminated duplicated spawn infrastructure between `spawnProcess` and `spawnAndWait` via a shared `spawnChild` helper
- Extracted helper functions from `runCommand` (`buildProfileEnv`, `setupController`, `setupStdinForwarding`) for clearer lifecycle boundaries
- Replaced `process.stdin.removeAllListeners('data')` with targeted `removeListener('data', reference)` using a stored handler reference
- Extracted shared `readLines` utility for JSON-line framing, used by both the IPC server (`controller/index.ts`) and client (`prompt.ts`)

## Files Changed
- `src/runtime/spawn.ts` — extracted `spawnChild()` internal function that handles executable resolution, `spawn()` call, PID registration, and `onChildSpawn` callback; both `spawnProcess` and `spawnAndWait` now call `spawnChild()` instead of duplicating logic; ~30 lines of duplication removed
- `src/commands/run.ts` — extracted `buildProfileEnv()` (config loading + env building), `setupController()` (creates controller with handler), `setupStdinForwarding()` (sets up targeted stdin listener + returns cleanup fn); replaced `removeAllListeners('data')` with `removeListener('data', onData)` using a stored reference; used `stdinCleanups` array for TypeScript-safe cleanup collection
- `src/controller/protocol.ts` — added exported `readLines(buffer, onLine)` utility that splits on `\n`, trims lines, calls callback for each complete line, returns remainder
- `src/controller/index.ts` — replaced inline framing logic with shared `readLines()` call
- `src/commands/prompt.ts` — replaced inline framing logic with shared `readLines()` call

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- spawn run controller prompt` -> `0` (92/92 passed across 7 suites)
- `npm test` -> `0` (209/209 passed across 22 suites)

## Runtime/IPC Validation (if applicable)
- behavior verification notes: Framing logic is identical pre/post refactor (same split/trim/pop pattern); all controller protocol tests (25) and prompt tests (18) pass unchanged; E2E controller socket tests (4) pass unchanged

## Duplicate/Performance Review
- duplicate code findings: Spawn duplication resolved (see AC mapping); JSON-line framing duplication resolved; `removeSessionByKey`/`deleteSession` in `sessions.ts` remain as-is (minor, different match semantics)
- hot-path/performance findings: none — refactoring does not change any hot paths or introduce new allocations
- proposed refactors: none

## Acceptance Criteria Mapping
- `Spawn duplication is materially reduced with a shared implementation path` -> pass; evidence: `src/runtime/spawn.ts` now uses `spawnChild()` internal function called by both `spawnProcess` and `spawnAndWait`, eliminating duplicate `findExecutablePath`, `spawn()`, `registerPID`, and `onChildSpawn` calls (~30 lines); all spawn tests pass (12 tests)
- `runCommand is split into smaller helpers with clearer lifecycle boundaries` -> pass; evidence: `buildProfileEnv()` handles config/env setup, `setupController()` handles controller creation + handler registration, `setupStdinForwarding()` handles stdin forwarding with targeted listener cleanup; original 150-line function reduced to focused orchestration (~65 lines of control flow); all run tests pass (12 tests)
- `Stdin listener cleanup is targeted (no removeAllListeners('data'))` -> pass; evidence: `src/commands/run.ts` stores the `onData` handler reference and calls `process.stdin.removeListener('data', onData)` instead of `removeAllListeners('data')`
- `JSON-line framing logic is shared between prompt client and controller server` -> pass; evidence: `src/controller/protocol.ts` exports `readLines()`; `src/controller/index.ts` and `src/commands/prompt.ts` both import and use it instead of inline split/trim logic; all controller tests (25) and prompt tests (18) pass
- `Existing tests remain green and new/updated tests cover refactored behavior` -> pass; evidence: full suite 209/209 passes (all existing tests unchanged); no new tests needed — refactoring is internal, no behavior changed

## Risks and Follow-ups
- none — all acceptance criteria met; no behavioral changes

## Roadmap Recommendations
- none — task 12 is complete
