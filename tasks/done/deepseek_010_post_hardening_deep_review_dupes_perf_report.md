# DeepSeek Post-Task Review

## ID
`deepseek_010_post_hardening_deep_review_dupes_perf`

## Agent
DeepSeek

## Execution Order
`10`

## File Ownership
- `tasks/deepseek_009_hardening_session_cleanup_signal_and_resume_tests_report.md`
- `tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Deep post-hardening code review focused on duplicate code and performance risks

## Context
Run after task `deepseek_009_hardening_session_cleanup_signal_and_resume_tests` is complete.

## Scope
- Verify task 009 acceptance criteria against code and tests.
- Deeply inspect prompt/session/controller/run/resume/sessions/spawn paths for duplicate code, unnecessary complexity, performance risks, and listener/resource lifecycle leaks.
- Produce actionable findings with file-level ownership for follow-up tasks.

## Non-goals
- Do not implement fixes unless explicitly requested.
- Do not review unrelated project areas.

## Validation
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- resume sessions spawn run prompt select` -> `0` (71/71 passed)
- `npm test` -> `0` (207/207 passed, 22 suites)

## Task ID
`deepseek_009_hardening_session_cleanup_signal_and_resume_tests`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| `removeSessionByKey` uses deterministic safe matching that prefers/removes intended pending session | pass | `src/commands/sessions.ts:191-193` checks `id.startsWith('pending_')` before generic key match; `test/sessions.test.ts` verifies pending removed while persisted with same key preserved |
| `spawnAndWait` cleans up signal listeners after child exit and avoids listener accumulation | pass | `src/runtime/spawn.ts:104-107` stores listeners as named refs and removes via `cleanup()` on `close`/`error`; `test/spawn.test.ts` verifies listener count returns to baseline after single call and 3 repeated calls |
| New tests verify resume reuses session key binding | pass | `test/run.test.ts` verifies `runCommand` with `{ sessionKey: 'my_reserved_key' }` produces that exact key in `onSessionStart` |
| Existing run/resume/sessions/spawn/prompt tests remain green | pass | Full suite 207/207, all existing tests unchanged and passing |

## Executive summary

Task 009 acceptance criteria are all met. The hardening pass resolved the P3 `removeSessionByKey` collision risk and signal listener accumulation. The overall code quality is good with clear separation of concerns. Two areas of notable duplication exist: the twin spawn functions (`spawnProcess`/`spawnAndWait`) and the JSON-line framing pattern split across the IPC client and server. No P0/P1 findings. One P2 finding (spawnProcess code duplication). Performance risks are negligible for the expected usage patterns.

## Findings

### P0

none

### P1

none

### P2

**P2-1: `spawnProcess` and `spawnAndWait` share extensive duplication**
- **severity**: P2
- **file path**: `src/runtime/spawn.ts:20-121`
- **problem**: `spawnProcess` (lines 20-52) and `spawnAndWait` (lines 54-121) duplicate ~30 lines of infrastructure: executable resolution, `spawn()` call with identical options, PID tracking registration, PID unregistration on close/error. The two functions differ only in stdio mode (always `'inherit'` vs conditional `['pipe','inherit','inherit']`) and signal handling (spawnProcess has none, spawnAndWait has SIGINT/SIGTERM forwarding).
- **impact**: Maintenance burden — any change to spawn infrastructure (e.g., adding a new spawn option) must be applied in two places. The `spawnProcess` function lacks the signal forwarding that `spawnAndWait` provides, creating an inconsistency.
- **recommendation**: Refactor `spawnAndWait` to be the single implementation. Replace `spawnProcess` callers with `spawnAndWait` (adjust if `detached: true` or other differences are needed). Alternatively, extract a shared `spawnChild` helper and have both functions call it.

### P3

**P3-1: `loadSessions` reads disk on every session operation with no cache**
- **severity**: P3
- **file path**: `src/commands/sessions.ts:28-38`
- **problem**: Every exported function (`addSession`, `getSessions`, `renameSession`, `deleteSession`, `findSessionByKey`, `updateSessionControllerEndpoint`, `removeSessionByKey`) calls `loadSessions()` which reads the JSON file from disk and parses it. In the `runCommand` flow, `addSession` and `removeSessionByKey` are both called, each reading the file independently. With the 50-session cap the file is small (~10KB), so this is not a performance bottleneck, but it is unnecessary I/O.
- **impact**: Each session mutation triggers a full file read + parse + write cycle. In practice the file is tiny (<50 entries), so the impact is negligible.
- **recommendation**: Add a simple in-memory cache with dirty-flag write-back. Low priority — only worth doing if session operations become a hot path.

**P3-2: `process.stdin.removeAllListeners('data')` in pipe mode is overly broad**
- **severity**: P3
- **file path**: `src/commands/run.ts:134`
- **problem**: In the `pipeStdin` cleanup path, `process.stdin.removeAllListeners('data')` removes ALL data listeners from stdin, not just the one added by `runCommand`. If another module had registered a data listener on stdin, it would be silently removed.
- **impact**: Low — stdin typically has a single listener. But the pattern is fragile.
- **recommendation**: Store a reference to the specific listener function and use `process.stdin.removeListener('data', handler)` instead of `removeAllListeners`.

### P4

**P4-1: `runCommand` has mixed responsibilities (142 lines)**
- **severity**: P4
- **file path**: `src/commands/run.ts:20-142`
- **problem**: The function handles config loading, validation, session key generation, controller lifecycle, session persistence, spawn configuration, error handling, and stdin forwarding. At 142 lines it exceeds a reasonable single-function size.
- **impact**: Readability and testability are reduced. Error handling edge cases (e.g., controller start failure combined with pipeStdin) are harder to reason about.
- **recommendation**: Extract stdin forwarding and controller lifecycle into helper functions. The `onChildSpawn` ternary (lines 101-115) should be a named function.

**P4-2: JSON-line framing duplicated in IPC client and server**
- **severity**: P4
- **file path**: `src/commands/prompt.ts:44-55` and `src/controller/index.ts:46-57`
- **problem**: Both the IPC client (`sendIpcRequest`) and server (`SessionController.handleMessage`) implement identical JSON-line framing logic: split buffer on `\n`, trim lines, process complete messages. This was flagged in the previous review (P4-1) and remains unaddressed.
- **impact**: Low — the pattern is ~10 lines and simple. If a third consumer appears, extraction becomes worthwhile.
- **recommendation**: Extract a shared `readLineFraming` utility in `src/controller/protocol.ts` once a third consumer appears.

## Duplicate-code Findings

- **`spawnProcess` vs `spawnAndWait`** (`src/runtime/spawn.ts`): ~30-line duplication of spawn infrastructure. See P2-1 above.
- **`removeSessionByKey` vs `deleteSession`** (`src/commands/sessions.ts`): Both iterate sessions and splice. `removeSessionByKey` could use `deleteSession` after resolving the profile, but this adds a second iteration. Current duplication is ~8 lines and acceptable.
- **JSON-line framing** (`src/commands/prompt.ts:44-55` vs `src/controller/index.ts:46-57`): Duplicated IPC message framing. ~10 lines, trivially extractable. See P4-2.

## Performance-risk Findings

- **Session file I/O**: `loadSessions`/`saveSessions` are called on every session operation. With <50 entries per profile and infrequent operations (once per session lifecycle), the performance impact is ~1-5ms per call. No action needed.
- **Controller startup**: `SessionController.start()` does sync fs operations + async listen. ~5-15ms per session start. Negligible.
- **Socket cleanup**: `controller.stop()` does async close + sync unlink. ~1-5ms. Negligible.

## Test/validation Gap Findings

- **No test for `spawnProcess`**: The `spawnProcess` function (used for non-waiting spawns) has no dedicated tests. Only `spawnAndWait` is tested.
- **No negative test for session file corruption**: `loadSessions` has a catch-all that returns `{}` on any parse error, but there's no test exercising a corrupted sessions file.
- **No performance benchmark**: Session I/O is fast enough, but there's no benchmark to detect regressions.

## Required Follow-up Tasks

1. **Refactor spawn functions** to eliminate duplication (P2-1). Ownership: `src/runtime/spawn.ts`.
2. **Fix `removeAllListeners('data')`** to use targeted listener removal (P3-2). Ownership: `src/commands/run.ts`.
3. **Extract JSON-line framing** into shared utility (P4-2, optional). Ownership: `src/controller/protocol.ts`, `src/commands/prompt.ts`.

## Completion Rule
- P0/P1 findings: none — no blockers.
- P2 findings: 1 finding (spawn duplication) requires follow-up task or explicit acceptance.
- P3/P4 findings may be batched.

## Deliverables
- report at `tasks/deepseek_010_post_hardening_deep_review_dupes_perf_report.md`
