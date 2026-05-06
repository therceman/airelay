# DeepSeek Post-Task Review

## ID
`deepseek_017_post_pty_migration_review`

## Agent
DeepSeek

## Execution Order
`17`

## File Ownership
- `tasks/deepseek_015_pty_proxy_foundation_for_always_promptable_sessions_report.md`
- `tasks/deepseek_016_remove_stdin_mode_split_and_unify_start_behavior_report.md`
- `tasks/deepseek_017_post_pty_migration_review_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Post-migration deep review for PTY promptability + harness-arg compatibility

## Context
Run after tasks 015 and 016 complete. The PTY proxy foundation was added, then the old stdin-mode split was cleaned up.

## Scope
- Verify acceptance criteria of tasks 015/016 against actual code/tests.
- Review PTY lifecycle/resource cleanup for leaks/regressions.
- Review prompt delivery correctness under PTY mode.
- Provide P0..P4 findings and concrete follow-up tasks.

## Non-goals
- Do not implement fixes unless explicitly assigned.

## Validation
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- run start resume prompt cli` -> `0` (93/93 passed)
- `npm test` -> `0` (222/222 passed, 23 suites)

## Task ID
`deepseek_015_pty_proxy_foundation_for_always_promptable_sessions`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Harness process launched via start sees terminal-compatible stdin/tty semantics | pass | `src/runtime/pty.ts` creates PTY with `xterm-256color`; child sees `isTTY = true`; `test/spawn.test.ts` PTY tests verify spawn and exit |
| `airelay prompt <session> ...` injects input into the same PTY-backed session | pass | `src/commands/run.ts:65-70` calls `ptyWrite.current(text)` for `session.input` requests; PTY delivers data to child's stdin |
| Resume-style harness args under start no longer hang due to stdin mode mismatch | pass | PTY always presents a TTY; no more pipe-vs-inherit mismatch; `start` always uses PTY mode |
| Existing tests pass; add PTY-path coverage | pass | 222/222 tests (2 new PTY tests in `test/spawn.test.ts`) |

## Task ID
`deepseek_016_remove_stdin_mode_split_and_unify_start_behavior`

### Acceptance criteria verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Start path is promptable by default and terminal-compatible for harness args | pass | `src/commands/start.ts:4` passes `{ usePty: true }`; PTY mode provides both TTY compat and stdin injection |
| No residual code path that depends on old stdin split for interactive launches | pass | `runCommand` option renamed from `pipeStdin` to `usePty`; no references to `pipeStdin` remain in `run.ts` or `start.ts` |
| CLI/docs/tests reflect unified behavior and remain green | pass | 222/222 tests pass; help text already documents `start` as launch path |

## Executive summary

The PTY migration (tasks 15-16) is functionally complete and all acceptance criteria are met. The architecture cleanly separates PTY-backed sessions (start command) from inherit-mode sessions (run/resume/select — interactive TUI). The controller handler correctly prioritizes `ptyWrite` > `childStdin` > clear error. 222/222 tests pass. One notable gap: the PTY path lacks SIGINT/SIGTERM forwarding (P3), and there is some dead code in `SpawnOptions` (`onChildSpawn`, `pipeStdin` for cross-spawn) that is no longer used (P4).

## Findings

### P0

none

### P1

none

### P2

none

### P3

**P3-1: PTY path missing SIGINT/SIGTERM forwarding**
- **severity**: P3
- **file path**: `src/runtime/spawn.ts:118-143` (`spawnAndWaitPty`)
- **problem**: The PTY spawn path in `spawnAndWaitPty` does not register `process.on('SIGINT')` / `process.on('SIGTERM')` handlers to forward signals to the PTY child. The cross-spawn path (lines 89-97) has this, but the PTY path does not. If the user presses Ctrl+C during a PTY-backed session, the parent process receives SIGINT but the PTY child is not killed and becomes orphaned.
- **impact**: Orphaned PTY processes when user interrupts a `start` session with Ctrl+C. The child process (opencode/codex) would continue running in the background.
- **recommendation**: Add signal forwarding in `spawnAndWaitPty` similar to the cross-spawn path: register `process.on('SIGINT', () => pty.kill('SIGINT'))` and `process.on('SIGTERM', () => pty.kill('SIGTERM'))`, with cleanup after the PTY exits.

**P3-2: PTY resize (SIGWINCH) not forwarded**
- **severity**: P3
- **file path**: `src/runtime/pty.ts:18-67`
- **problem**: The PTY is created with fixed 80x24 dimensions. When the user resizes their terminal window, the PTY dimensions are not updated. Full-screen TUI apps (opencode/codex) that respond to terminal resize events will render incorrectly.
- **impact**: Visual artifacts or layout issues in full-screen TUI apps when the terminal is resized during a PTY-backed session.
- **recommendation**: Add a `SIGWINCH` handler on `process.stdout` that calls `pty.resize(process.stdout.columns, process.stdout.rows)` when the terminal is resized.

### P4

**P4-1: `onChildSpawn` in `SpawnOptions` is dead code**
- **severity**: P4
- **file path**: `src/runtime/spawn.ts:15,40-42`
- **problem**: The `onChildSpawn` callback in `SpawnOptions` is no longer set by any caller after the PTY migration. It remains in the interface and is called by `spawnChild`, but no caller provides it. The `onPtyReady` callback replaced it for the PTY path.
- **impact**: Minor dead code (~5 lines). Increases maintenance surface.
- **recommendation**: Remove `onChildSpawn` from `SpawnOptions` and `spawnChild` in a future cleanup pass.

**P4-2: `pipeStdin` in `SpawnOptions` is unused by callers**
- **severity**: P4
- **file path**: `src/runtime/spawn.ts:13,30`
- **problem**: The `pipeStdin` field in `SpawnOptions` controls piped stdin in the cross-spawn path. After the PTY migration, no caller sets `pipeStdin` to `true` (the old `pipeStdin: true` in `run.ts` was replaced with `usePty: true`). The field still works if set, but no code uses it.
- **impact**: Dead option that may cause confusion.
- **recommendation**: Either remove `pipeStdin` from `SpawnOptions` or document it as a low-level cross-spawn option.

## Duplicate-code Findings

- **Signal handling in spawn vs PTY paths**: The cross-spawn path has signal forwarding (P3-1 finding about its absence in PTY path). No duplication.

## Performance-risk Findings

- **PTY creation overhead**: `node-pty` spawn adds ~1-5ms per session. Negligible.
- **stdin forwarding**: `process.stdin.setRawMode(true)` is called in the PTY path (in `createPty`) and also in the `onStdinData` handler. This is correct because the PTY path doesn't go through `setupStdinForwarding` anymore — it's handled directly in `pty.ts`. No duplication.

## Test/validation Gap Findings

- **No test for `prompt` + PTY end-to-end**: The `test/controller-e2e.test.ts` tests the controller + prompt flow using direct socket connections, but doesn't test the full `start` → PTY → `prompt` path. An integration test that starts a real PTY session and sends a prompt would be valuable.
- **No SIGWINCH resize test**: Window resize handling is not tested.

## Required Follow-up Tasks

1. **Add SIGINT/SIGTERM forwarding to PTY path** (P3-1). Ownership: `src/runtime/spawn.ts`.
2. **Add SIGWINCH handler for PTY resize** (P3-2). Ownership: `src/runtime/pty.ts`.
3. **Clean up dead `onChildSpawn` and `pipeStdin` from `SpawnOptions`** (P4-1, P4-2). Ownership: `src/runtime/spawn.ts`.

## Completion Rule
- P0/P1 findings: none — no blockers.
- P2 findings: none.
- P3/P4 findings may be batched.

## Deliverables
- report at `tasks/deepseek_017_post_pty_migration_review_report.md`
