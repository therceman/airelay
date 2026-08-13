# Task Report

## Task ID
`deepseek_074_fix_tail_actual_live_viewport`

## Summary
- Fixed `tail` (via `session.viewport` IPC) to read the actual live viewport instead of the top of the bottom scrollback page.
- Root cause: `SessionController.getLiveViewportLines()` iterated `buffer.baseY` (`ybase`), which is the top of the bottom scrollback page, not the currently displayed viewport. xterm exposes `buffer.viewportY` (`ydisp`) as the top of the displayed viewport; the two diverge whenever the terminal is scrolled.
- Changed `getLiveViewportLines()` to iterate from `buffer.viewportY`. `baseY` usage remains untouched in the transcript path (`getTranscriptViewportLines`) to preserve transcript/history/capacity behavior.
- Added a deterministic regression test that creates a `viewportY != baseY` state via `scrollLines(-5)` and proves `tail`/`session.viewport` returns the visible section, plus focused `tail` tests for `--lines`, `--skip`, and blank-row handling.
- Extended the shared test isolation helper (`test/test-utils.ts`) with `AIRELAY_SOCKETS_DIR`/`AIRELAY_TRANSCRIPTS_DIR` so the new tail test complies with AGENTS.md ("tests MUST use test/utils.ts + useTestEnv(); never touch ~/.airelay").

## Files Changed
- `src/controller/index.ts` — `getLiveViewportLines()` now iterates `buffer.viewportY` instead of `buffer.baseY`; added `viewportPositionForTest()`/`scrollViewportForTest()` test accessors (consistent with existing `lastOutputChangeAtForTest()`). No other controller behavior changed.
- `test/controller-e2e.test.ts` — added regression test "tail reads the live viewport when scrolled up (viewportY differs from baseY)" that deliberately diverges `viewportY` from `baseY` and verifies both `getLiveViewportLines()` and the full `session.viewport` IPC path.
- `test/tail.test.ts` — new focused tests: `--lines` returns last N non-empty lines, `--skip` excludes trailing lines, blank rows are skipped. Uses `useTestEnv()` only.
- `test/test-utils.ts` — `setupTestEnv`/`setupEnv`/`cleanupEnv` now isolate `AIRELAY_SOCKETS_DIR` and `AIRELAY_TRANSCRIPTS_DIR` into the per-suite temp dir (required so the new tail test can construct a real `SessionController` socket without touching `~/.airelay`). Behavior-preserving for all existing `useTestEnv` users.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand test/controller-e2e.test.ts` -> `0` (15 passed)
- `npm test -- --runInBand test/tail.test.ts` -> `0` (3 passed)
- `npm test -- --runInBand` (full suite) -> `0` (32 suites / 346 tests passed)

## Runtime/IPC Validation (if applicable)
- command transcript snippets:
  - Reproduced divergence empirically with `@xterm/headless` before fixing: after 50 lines + `scrollLines(-5)` on a 30-row terminal, `viewportY=18` while `baseY=23`; reading at `viewportY` returns `line 16..line 45`, reading at `baseY` returns `line 21..line 49`. This proves `baseY` is the bottom scrollback page top, not the visible viewport origin.
  - Regression test (IPC path): feeds 50 CR/LF lines, scrolls up 5, asserts `viewportPositionForTest().viewportY < .baseY`, then `fetchSessionViewport()` contains `line 20` and does NOT contain `line 49`.
  - Tail command integration: `tail <session> --lines 5` -> `line 45..line 49`; `tail --lines 5 --skip 3` -> `line 42..line 46` (unchanged slicing in `src/commands/tail.ts`).
- behavior verification notes:
  - In normal live operation the headless terminal is never scrolled, so `viewportY === baseY` and existing snapshot/transcript/capacity behavior is byte-for-byte identical; the fix only changes the result when the viewport is actually scrolled.

## Duplicate/Performance Review
- duplicate code findings: `getTranscriptViewportLines()` still iterates `baseY` intentionally (transcript persistence is a non-goal of this task); noted as a candidate follow-up for the roadmap rather than changed here.
- hot-path/performance findings: none — the viewport loop is identical except for the start coordinate.
- proposed refactors: none.

## Acceptance Criteria Mapping
- `airelay tail <session> --lines N` returns the last N non-empty lines from the actual currently displayed viewport, including bottom/end content -> `pass`; evidence: `test/tail.test.ts` ("tail --lines returns the last N non-empty lines from the live viewport"), `test/controller-e2e.test.ts` live-viewport regression.
- Implementation uses the correct xterm viewport coordinate and does not assume `baseY` is the visible viewport origin -> `pass`; evidence: `src/controller/index.ts` `getLiveViewportLines()` starts at `buffer.viewportY` (see doc comment); regression asserts `viewportY < baseY` under scroll.
- Existing normal-buffer, alternate-buffer, wrapping, CR-overwrite, and scrolled-off behavior remains correct -> `pass`; evidence: unchanged pre-existing tests in `test/controller-e2e.test.ts` ("session.viewport IPC returns visible lines", "viewport reflects CR-overwritten lines correctly", "scrolled-off lines do not appear in viewport", snapshot-window tests) all still pass; full suite 346/346.
- Regression test creating a deliberate `viewportY` vs `baseY` difference proving tail reads the visible section -> `pass`; evidence: `test/controller-e2e.test.ts` "tail reads the live viewport when scrolled up (viewportY differs from baseY)" via `scrollViewportForTest(-5)`.
- Existing `--skip` behavior remains unchanged and is covered -> `pass`; evidence: slicing logic in `src/commands/tail.ts` untouched; `test/tail.test.ts` ("tail --skip excludes the trailing lines from the live viewport output").
- No unrelated source changes -> `pass`; evidence: production diff is only the `getLiveViewportLines` start coordinate + two test accessors. `test/test-utils.ts` change is test-infrastructure isolation required by AGENTS.md for the new socket-based tail test; no production behavior change.

## Risks and Follow-ups
- `test/test-utils.ts` was modified outside the original file-ownership list. This was mandated by AGENTS.md ("Tests MUST use test/utils.ts and useTestEnv(); do not manually set AIRELAY_SESSIONS/AIRELAY_SOCKETS_DIR"). It only adds sockets/transcripts isolation to the shared helper; verified against the full suite (346/346).
- `getTranscriptViewportLines()` retains `baseY` semantics; if transcript snapshots should also reflect the true displayed viewport in the future, that is a separate task (roadmap suggestion below).

## Roadmap Recommendations
- Consider a follow-up task to decide whether transcript snapshots should use `viewportY` too (currently intentionally unchanged per this task's non-goals).

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_074_fix_tail_actual_live_viewport_done"`
- Notification attempt result: command run after rename; failed twice with
  `Error: Controller offline for session: gpt_master_airelay` (exit code 1) — the manager
  session controller is not currently running, so the ping could not be delivered. Report
  final rename and full validation are complete; the ping must be re-sent once the manager
  session is active.
