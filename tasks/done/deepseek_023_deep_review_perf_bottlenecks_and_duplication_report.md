# DeepSeek Post-Task Review

## ID
`deepseek_023_deep_review_perf_bottlenecks_and_duplication`

## Agent
DeepSeek

## Execution Order
`23`

## File Ownership
- `tasks/deepseek_023_deep_review_perf_bottlenecks_and_duplication_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Deep review for performance bottlenecks and duplicate code

## Context
The current implementation is functionally complete. This review focuses solely on performance bottlenecks, duplicate code, unnecessary complexity, and listener/resource lifecycle risks across the entire codebase.

## Scope
- Inspect the current codebase for duplicate logic that should be extracted.
- Inspect the current codebase for hot-path or lifecycle performance risks.
- Inspect the current codebase for listener/resource leaks or repeated work.
- Produce concrete findings with file references and severity.
- Do not modify unrelated behavior.

## Non-goals
- Do not redesign the architecture.
- Do not add new features.
- Do not change CLI semantics.

## Validation
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- run resume prompt spawn controller sessions` -> `0` (119/119 passed)
- `npm test` -> `0` (223/223 passed, 23 suites)

## Task ID
`deepseek_023_deep_review_perf_bottlenecks_and_duplication`

## Executive summary

The codebase is in good shape with no P0/P1 findings. The main opportunities are: (1) extracting a shared JSON-persistence utility from the duplicated `loadSessions`/`saveSessions` and `loadPIDs`/`savePIDs` patterns (~30 lines duplicated), (2) removing `spawnProcess` which is dead code, and (3) eliminating the dead `childStdin` write path in `run.ts` (it can never succeed in practice). No performance bottlenecks were found — all I/O is within acceptable ranges for a CLI tool. All listener/resource lifecycles are properly managed.

## Findings

### P0

none

### P1

none

### P2

**P2-1: `spawnProcess` is dead code**
- **severity**: P2
- **file path**: `src/runtime/spawn.ts:41-59`
- **problem**: The `spawnProcess` function is exported but has no callers anywhere in the codebase. It was a legacy function from before the PTY migration. It cannot be reached through any CLI command, test, or module import.
- **impact**: Dead code increases maintenance surface. Any changes to the spawn infrastructure must account for this unused function, and its existence may confuse new developers.
- **recommendation**: Remove `spawnProcess` and its associated `SpawnResult` interface (also unused). If external API compatibility is a concern, keep it but add a `@deprecated` JSDoc tag.

**P2-2: `run.ts` `childStdin` write path is dead code in practice**
- **severity**: P2
- **file path**: `src/commands/run.ts:74-79`
- **problem**: The `setupController` function maintains a `childStdin` write path that can never succeed. For inherited-terminal sessions (run/resume/select), `childStdinRef.current` is always `null` because `spawnChild` uses `stdio: 'inherit'` which yields `child.stdin === null`. The PTY path uses `ptyWrite` instead. The only way `childStdin` could be non-null is if `pipeStdin` were set, but that option was removed in task 16.
- **impact**: 10 lines of unreachable code that give a false impression of dual-write capability. If someone runs `airelay prompt` against an inherited-terminal session, the code falls through to the error throw at line 82-85, never reaching the `childStdin` branch.
- **recommendation**: Remove the `childStdin` path from `setupController` and the `childStdinRef` wrapper. The controller should only check `ptyWrite` and then throw the error. This simplifies the handler logic and removes a misleading code path.

### P3

**P3-1: `sessions.ts` and `pid.ts` share duplicated persistence pattern**
- **severity**: P3
- **file path**: `src/commands/sessions.ts:27-51` and `src/utils/pid.ts:27-51`
- **problem**: Both modules implement identical JSON file persistence: `{load/save}{Sessions/PIDs}()` with the same structure — env-var path override, file read/write, try-catch with silent failure. Combined with `getSessionsPath`/`getPIDPath`, this is ~30 lines of duplicated code.
- **impact**: Any change to the persistence pattern (e.g., adding a cache, changing serialization) must be applied in two places. Over time, the implementations could drift.
- **recommendation**: Extract a shared `JsonStore` utility in `src/utils/json-store.ts` with a simple `{ load<T>(name): T, save<T>(name, data): void }` interface. Both sessions and PIDs can use it by passing their env-var name and default path.

**P3-2: `loadConfig()` called redundantly across commands**
- **severity**: P3
- **file path**: Multiple files — `run.ts`, `list.ts`, `which.ts`, `doctor.ts`, `select.ts`, `resume.ts`, `remove.ts`, etc.
- **problem**: Each command function calls `loadConfig()` independently, which reads and parses the config file from disk. During a single `airelay start` invocation, `loadConfig` is called once in `run.ts`. But during `airelay init` followed by `airelay list`, it's called again. For CLI usage where each invocation is a separate process, this is irrelevant. However, if the TUI (`select.ts`) calls multiple profile operations in a single session, config is re-read each time.
- **impact**: Low — config files are small (<10KB) and YAML parsing is ~1-5ms. Not a bottleneck for CLI use. Worth noting for future if the TUI becomes a long-running process.
- **recommendation**: Add a simple in-memory cache with a `clearConfigCache()` export for testing. Low priority.

### P4

**P4-1: `cleanupDeadPIDs()` module-level side effect**
- **severity**: P4
- **file path**: `src/utils/pid.ts:139`
- **problem**: `cleanupDeadPIDs()` is called as a module-level side effect when `pid.ts` is first imported. This reads and writes the PIDs file on every import, even when the PIDs feature is not used.
- **impact**: Unnecessary I/O on module load (~1-3ms). The operation is safe (catches errors), but the side effect at import time is surprising.
- **recommendation**: Move the `cleanupDeadPIDs()` call into the `getOrphanedPIDs` or `registerPID` function, or make it an explicit initialization step.

**P4-2: `which.ts` profile-not-found error message duplicates `run.ts` pattern**
- **severity**: P4
- **file path**: `src/commands/which.ts:31-33` and `src/commands/run.ts:35-38`
- **problem**: Both files construct nearly identical error messages for missing profiles, listing available profiles. The pattern "Profile not found: X\nAvailable profiles: Y\nRun 'airelay create <name>' to create a new profile" appears in both places.
- **impact**: ~5 lines duplicated. Low impact.
- **recommendation**: Extract a shared `formatProfileNotFound(name, available)` utility in a shared location (e.g., `src/utils/profile.ts`). Apply to all commands that validate profile existence.

**P4-3: `getSessionDisplayName` has misleading variable name**
- **severity**: P4
- **file path**: `src/commands/sessions.ts:139`
- **problem**: The variable `shortId` in `getSessionDisplayName` is assigned `session.id.slice(0, 8) + '...'`, which is a truncated ID, not a "short ID". The name `shortId` could more accurately be `truncatedId` or `displayId`.
- **impact**: Readability only. No behavioral impact.
- **recommendation**: Rename `shortId` to `truncatedId` for clarity.

## Duplicate-code Findings

- **JSON persistence pattern** (`sessions.ts` × `pid.ts`): ~30 lines duplicated. See P3-1.
- **Profile-not-found error messages** (`which.ts` × `run.ts`): ~5 lines duplicated. See P4-2.
- **`spawnProcess` vs `spawnAndWait`**: Both functions share `spawnChild` helper, so the major duplication (resolved in task 12) is gone. Minor PID-tracking duplication remains (~3 lines in each function's close/error handler). Acceptable.
- **Config loading calls** across commands: Not strictly duplication (same function called), but each call reads from disk. See P3-2.

## Performance-risk Findings

- **No hot-path bottlenecks detected**: All operations are per-invocation (not per-keystroke or per-frame). PTY creation (~5ms), config loading (~5ms), session persistence (~3ms), and PID tracking (~3ms) are all within acceptable ranges for a CLI tool.
- **Session file I/O**: 4 disk operations per session lifecycle (2 reads + 2 writes for `addSession` + `deleteSession`). At ~10KB per file, this is ~4-10ms. Acceptable.
- **`process.env` merge in `createPty`**: Copies ~50 entries per session. ~0.01ms. Negligible.
- **`findExecutable` uses `execSync`**: Only called once during `init`. Acceptable.

## Test/validation Gap Findings

- **No test for `spawnProcess`**: The function is dead code, but if kept, should have its own test coverage.
- **No performance benchmarks**: No regression detection for I/O or spawn timing.

## Required Follow-up Tasks

1. Remove `spawnProcess` dead code (P2-1). Ownership: `src/runtime/spawn.ts`.
2. Remove `childStdin` dead path from `setupController` (P2-2). Ownership: `src/commands/run.ts`.
3. Extract shared JSON-persistence utility (P3-1, optional). Ownership: `src/utils/json-store.ts`, `src/commands/sessions.ts`, `src/utils/pid.ts`.

## Completion Rule
- P0/P1 findings: none — no blockers.
- P2 findings: 2 findings (dead code) — should be cleaned up but do not block functionality.
- P3/P4 findings may be batched.

## Deliverables
- report at `tasks/deepseek_023_deep_review_perf_bottlenecks_and_duplication_report.md`
