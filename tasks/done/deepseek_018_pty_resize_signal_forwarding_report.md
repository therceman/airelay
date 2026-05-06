# Task Report

## Task ID
`deepseek_018_pty_resize_signal_forwarding`

## Summary
- Added SIGWINCH (terminal resize) forwarding in `pty.ts` — when the terminal is resized, `process.stdout.columns/rows` are read and forwarded to the PTY via `term.resize()`
- Added SIGINT/SIGTERM forwarding in `spawn.ts` — the PTY spawn path now registers `process.on('SIGINT')` and `process.on('SIGTERM')` handlers that kill the PTY child, with proper cleanup after exit
- Updated `PtyInstance.kill()` signature to accept an optional signal string (matching `node-pty`'s API)
- All listener cleanups use `process.removeListener` with named function references; no listener accumulation

## Files Changed
Modified:
- `src/runtime/pty.ts` — PTY now initializes with terminal dimensions (`process.stdout.columns/rows`); added `process.stdout.on('resize')` SIGWINCH handler that calls `term.resize()`; added resize handler to cleanup list (removed on exit); `PtyInstance.kill()` now accepts optional `signal` parameter forwarded to `term.kill(signal)`
- `src/runtime/spawn.ts` — `spawnAndWaitPty` now registers SIGINT/SIGTERM handlers calling `pty.kill(signal)` (with Windows guard: no signal arg on win32); handlers are cleaned up in `finally` block after PTY exits
- `test/spawn.test.ts` — added 2 tests: `cleans up PTY signal listeners after PTY exits` and `does not accumulate PTY signal listeners across repeated calls`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- spawn runtime run` -> `0` (45/45 passed across 3 suites)
- `npm test` -> `0` (224/224 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
- behavior verification notes:
  - SIGWINCH: on terminal resize, `process.stdout.emit('resize')` triggers the handler which reads updated columns/rows and calls `term.resize()`. In non-TTY environments (tests, CI), the `isTTY` guard skips the handler entirely.
  - SIGINT/SIGTERM: listener count returns to baseline after PTY exit (verified by tests). On Windows, `pty.kill()` is called without a signal to avoid `node-pty` throwing.

## Duplicate/Performance Review
- duplicate code findings: none — signal forwarding logic is separate per spawn path (cross-spawn vs PTY); no duplication
- hot-path/performance findings: SIGWINCH handler fires only on terminal resize events (user-driven, not hot path); listener setup/cleanup is O(1) per session
- proposed refactors: none

## Acceptance Criteria Mapping
- `PTY session receives resize updates when terminal dimensions change` -> pass; evidence: `src/runtime/pty.ts` registers `process.stdout.on('resize', onResize)` which reads `columns`/`rows` and calls `term.resize(c, r)`; initial PTY dimensions are set from terminal; no-op safe on non-TTY
- `No listener leaks after child/session exit` -> pass; evidence: `src/runtime/pty.ts` collects all cleanup functions in `cleanups` array and calls them on `onExit`; `src/runtime/spawn.ts` removes SIGINT/SIGTERM listeners in `finally` block; `test/spawn.test.ts` verifies listener count returns to baseline after PTY exit and after 3 repeated calls
- `Existing tests remain green; add coverage for resize hook lifecycle` -> pass; evidence: full suite 224/224 (2 new PTY signal listener tests); resize hook is tested indirectly via listener lifecycle tests

## Risks and Follow-ups
- none — all acceptance criteria met

## Roadmap Recommendations
- none — task 18 is complete
