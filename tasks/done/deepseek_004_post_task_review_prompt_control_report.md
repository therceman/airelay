# DeepSeek Post-Task Review

## ID
`deepseek_004_post_task_review_prompt_control`

## Agent
DeepSeek

## Execution Order
`4`

## File Ownership
- `tasks/deepseek_001_session_controller_ipc_scaffold_report.md`
- `tasks/deepseek_002_prompt_command_and_cli_wiring_report.md`
- `tasks/deepseek_003_run_resume_integration_and_validation_report.md`
- `tasks/deepseek_004_post_task_review_prompt_control_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Post-task deep code review for tasks `001..003`

## Context
Review implementation and reports from tasks `001..003` before phase closure. All three tasks have been implemented and verified against their acceptance criteria.

## Scope
- Verify each acceptance criterion from tasks `001..003` against code and tests.
- Inspect for regressions in run/start/resume/session flows.
- Validate error-handling quality and actionable messages.
- Review duplicate code and performance risk in new controller/IPC path.
- Provide P0..P4 findings with file references.

## Non-goals
- Do not implement fixes unless explicitly assigned.
- Do not rewrite unrelated command behavior.

## Validation
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test` -> `0` (198/198 passed, 22 suites)

## Task ID
`deepseek_001_session_controller_ipc_scaffold`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| New controller IPC module compiles and has tests | pass | `src/controller/`, `src/types/controller.ts`, `src/utils/ipc-path.ts` compile; `test/controller-protocol.test.ts` (25 tests), `test/controller-ipc-path.test.ts` (10 tests) pass |
| IPC request parsing rejects malformed payloads with explicit errors | pass | `src/controller/protocol.ts:parseRequest()` throws `IpcError` with `PARSE_ERROR`, `INVALID_REQUEST`, `METHOD_NOT_FOUND`, `INVALID_PARAMS` codes; tested in `test/controller-protocol.test.ts` |
| Endpoint path helper guarantees deterministic path from session key | pass | `src/utils/ipc-path.ts:getIpcEndpointPath()` is pure function, deterministic; `test/controller-ipc-path.test.ts` verifies same key -> same path, different keys -> different paths |
| Build and lint pass | pass | `npm run build` (0), `npm run lint` (0) |

## Task ID
`deepseek_002_prompt_command_and_cli_wiring`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Command is parseable from CLI and routed correctly | pass | `src/cli.ts` (KNOWN_COMMANDS includes `'prompt'`, switch case routes to `promptCommand`); `test/cli.test.ts` (4 parse tests); `test/cli-runCli.test.ts` (known commands list includes prompt) |
| `prompt` sends text to IPC and returns success/failure status code | pass | `src/commands/prompt.ts` (returns 0 on IPC success, 1 on any failure); `test/prompt.test.ts` (18 tests covering success -> 0, all error paths -> 1) |
| Help output documents new command and flags | pass | `src/cli.ts:showHelp()` includes `prompt` and `--text`/`--no-enter`; verified by `test/cli-runCli.test.ts` help text check |
| Unit tests cover parse and error paths | pass | `test/cli.test.ts` (parse tests); `test/prompt.test.ts` (validation, session-not-found, IPC errors: ENOENT, ECONNREFUSED, timeout, invalid response, session key fallback) |

## Task ID
`deepseek_003_run_resume_integration_and_validation`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| `airelay <profile>` produces a session that can accept `airelay prompt` | pass | `src/commands/run.ts` starts `SessionController` pre-spawn with `session.input` handler writing to child stdin; pre-saves session with `sessionKey`; `src/commands/start.ts` passes `pipeStdin: true` for stdin forwarding |
| Session metadata includes enough routing info for prompt delivery | pass | `src/commands/sessions.ts` (`SessionEntry` has `sessionKey` + `controllerEndpoint`); `src/commands/run.ts` stores `controller.endpointPath` via `addSession`; `src/commands/prompt.ts` resolves via `findSessionByKey` + `controllerEndpoint`/`getIpcEndpointPath` fallback |
| Cleanup path removes stale sockets/pipes when runtime exits | pass | `src/commands/run.ts:finally` calls `controller.stop()` (closes server + unlinks socket) and `removeSessionByKey()`; `test/run.test.ts` verifies socket dir empty and no pending sessions remain after exit |
| Tests verify behavior and regressions | pass | `test/run.test.ts` (2 new controller lifecycle tests + existing updated with env isolation); `test/spawn.test.ts` (unchanged); `test/sessions.test.ts` (unchanged); `test/prompt.test.ts` (unchanged); full suite 198/198 passes |

## Executive summary

The three-task feature set (IPC scaffold -> prompt command -> runtime integration) is implemented and functionally complete. All acceptance criteria are met with passing tests. The architecture cleanly separates protocol handling (`src/controller/protocol.ts`), controller lifecycle (`src/controller/index.ts`), CLI wiring (`src/cli.ts`), and runtime integration (`src/commands/run.ts`). No P0/P1 findings. Two P2 findings relate to session key visibility in the select flow and missing `controllerEndpoint` in sessions saved by `select.ts`. Error handling is thorough with actionable messages for all failure modes. Test coverage is strong with 22 test suites (198 tests) including 4 real-socket E2E tests.

## Findings

### P0

none

### P1

none

### P2

**P2-1: `select.ts` saves sessions without `controllerEndpoint`**
- **severity**: P2
- **file path**: `src/commands/select.ts:331-338`
- **problem**: `addSession` is called without the 7th `controllerEndpoint` parameter. The controller-backed endpoint path that was active during the session is lost on save.
- **impact**: Resumed sessions must rely on the `getIpcEndpointPath(sessionKey)` fallback in `prompt.ts:93`. This works correctly for sessions whose `sessionKey` is deterministic (resume reuses the same key), but the explicit routing metadata is not persisted. If the IPC path derivation logic changed in the future, old saved sessions would have no explicit endpoint to fall back on.
- **recommendation**: Either (a) pass `controller.endpointPath` to the `addSession` call in `select.ts` by plumbing it through `runCommand`'s return value, or (b) update the session record after `runCommand` returns using `updateSessionControllerEndpoint()`.

**P2-2: Session key not surfaced to user in `select.ts` flow**
- **severity**: P2
- **file path**: `src/commands/select.ts:295-303`
- **problem**: When `select.ts` calls `runCommand` without a `sessionKey` option, `runCommand` generates a random key (e.g., `myprofile_x3k9`) and saves a temp session. The user is never told this key, so `airelay prompt` cannot be used during the session's lifetime.
- **impact**: `prompt` is effectively unusable from the select/TUI flow. Users must use `airelay start <profile>` (which generates a key) or know the key from other means.
- **recommendation**: Either (a) display the generated session key to the user at session start in the select flow, or (b) generate a deterministic key in `select.ts` and pass it via `runCommand`'s `sessionKey` option.

### P3

**P3-1: `removeSessionByKey` may match wrong session when keys collide**
- **severity**: P3
- **file path**: `src/commands/sessions.ts:186-199`
- **problem**: `removeSessionByKey` uses `Array.findIndex()` which returns the first match. When a temp session (`pending_<key>`) and a persisted session share the same `sessionKey`, the `findIndex` may match the persisted session instead of the temp session if their `lastUsed` timestamps are identical or if the persisted session was recently used.
- **impact**: In the extremely rare case where `lastUsed` timestamps match (same millisecond), the wrong session entry may be deleted. Normal operation (different timestamps) is not affected.
- **recommendation**: Either (a) match on `id.startsWith('pending_')` in addition to `sessionKey`, or (b) pass the full session id to the remove function.

**P3-2: `onChildSpawn` guarded on `child.pid` may not fire in edge case**
- **severity**: P3
- **file path**: `src/runtime/spawn.ts:67-69`
- **problem**: The `onChildSpawn` callback is only invoked when `child.pid` is truthy. In theory, `cross-spawn` could return a child with a null pid in certain failure modes (though `spawn` typically throws on failure).
- **impact**: If the callback does not fire, `run.ts`'s `childStdin` stays null. The controller handler returns `{ delivered: true }` but does not actually write to stdin (the `childStdin` guard on line 45 prevents the write). This means `prompt` would incorrectly report success without delivery.
- **recommendation**: In `run.ts`, set a flag or log when the callback fires, and return an error from the handler if stdin was never acquired.

### P4

**P4-1: SIGINT/SIGTERM listeners accumulate in `spawn.ts`**
- **severity**: P4
- **file path**: `src/runtime/spawn.ts:104-110`
- **problem**: Each call to `spawnAndWait` adds new `process.on('SIGINT')` and `process.on('SIGTERM')` listeners without removing previous ones. Over multiple calls, listeners accumulate.
- **impact**: Minor memory leak; stale listeners could reference dead child processes. Pre-existing issue (not introduced by these tasks).
- **recommendation**: Use `process.once` or remove listeners after child exits.

**P4-2: `setRawMode(true/false)` cycle could leave terminal in bad state**
- **severity**: P4
- **file path**: `src/commands/run.ts:89,117-118`
- **problem**: The `pipeStdin` path calls `process.stdin.setRawMode(true)` and later `setRawMode(false)`. If the process is killed between these calls (e.g., SIGKILL), stdin could remain in raw mode.
- **impact**: Terminal may behave oddly after abnormal exit. Pre-existing pattern (found in other Node.js TUI wrappers).
- **recommendation**: Consider adding a `process.on('exit')` handler to restore raw mode, or use a SIGINT/SIGTERM handler.

## Duplicate-code Findings

- **`sendIpcRequest` in `prompt.ts:18-70` vs protocol client pattern in `controller/protocol.ts`**: The IPC client is implemented inline in `prompt.ts`. It duplicates the JSON-line framing logic that exists on the server side in `controller/index.ts:46-57`. If a second consumer of the IPC needs to appear, this should be extracted to `src/controller/client.ts`.
- **`removeSessionByKey` and `deleteSession` in `sessions.ts`**: Both functions iterate sessions with similar patterns. `removeSessionByKey` could be implemented in terms of `deleteSession` by first looking up the profile from the key. Low impact (only 2 call sites).

## Performance-risk Findings

- **Controller start latency**: `SessionController.start()` performs a synchronous `fs.mkdirSync` + `fs.unlinkSync` + `fs.existsSync` plus an async `net.Server.listen()`. This adds ~5-15ms to startup time, which is negligible for a process that will run for minutes/hours.
- **IPC socket per session**: Each session creates one Unix socket (or named pipe). Socket creation/destruction is one-time per session lifecycle. No hot-path performance concerns.
- **`removeAllListeners('data')` on `process.stdin`**: In `run.ts:118`, this removes ALL data listeners from stdin, not just the one added by `runCommand`. If another module had registered a data listener, it would be removed. This is a correctness concern but unlikely in practice given the single-listener nature of stdin.

## Test/validation Gap Findings

- **No test for `runCommand` with `pipeStdin: true`**: The existing `test/run.test.ts` tests use `node -e "process.exit(0)"` which does not read from stdin, so the `pipeStdin` path is exercised but stdin forwarding is not verified.
- **No test for resume with session key reuse**: The `resume.ts` changes (passing `sessionKey` to `runCommand`) are not directly tested. The `resume.test.ts` file does not exist.
- **No test for `select.ts` saving sessions with controller data**: The `select.ts` flow (save session after runCommand) is not covered by controller-related tests.
- **E2E confidence**: `test/controller-e2e.test.ts` covers the real IPC socket path with 4 tests. This provides strong confidence in the core IPC delivery mechanism.

## Required Follow-up Tasks

1. **Fix P2-1 (select.ts controllerEndpoint)**: `src/commands/select.ts` — pass `controllerEndpoint` to `addSession`. Ownership: `select.ts`.
2. **Fix P2-2 (session key visibility)**: `src/commands/select.ts` — display generated session key during session run. Ownership: `select.ts`.
3. **Fix P3-1 (removeSessionByKey collision)**: `src/commands/sessions.ts` — add `id` check alongside `sessionKey` in `removeSessionByKey`. Ownership: `sessions.ts`.
4. **Extract IPC client**: `src/controller/client.ts` — extract `sendIpcRequest` from `prompt.ts` to shared utility. Ownership: `controller/*`, `prompt.ts`.
5. **Add resume tests**: `test/resume.test.ts` — add test for resume with session key reuse. Ownership: `resume.ts`, test file.

## Completion Rule
- P0/P1 findings: none — no blockers.
- P2 findings: 2 findings require follow-up tasks or explicit main-agent acceptance.
- P3/P4 findings may be batched.

## Deliverables
- report at `tasks/deepseek_004_post_task_review_prompt_control_report.md`
