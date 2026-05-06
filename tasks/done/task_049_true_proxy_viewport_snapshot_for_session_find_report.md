# Task Report

## Task ID
`task_049_true_proxy_viewport_snapshot_for_session_find`

## Summary
Replaced heuristic line-buffer viewport with a true proxy terminal emulator (`@xterm/headless` v6.0.0). The `SessionController` now maintains an in-process `xterm.Terminal` instance that receives all PTY output and maintains an accurate screen buffer, handling all ANSI sequences, cursor movements, `\r` carriage returns, scrolling, and alternate buffer content.

Changes:
1. **Installed `@xterm/headless`** — proper headless terminal emulator, 0 runtime dependencies
2. **Controller reworked** — `feedOutput` writes to the xterm terminal; `session.viewport` reads from `terminal.buffer.active` lines (baseY + rows); `flushViewport()` flushes pending xterm writes
3. **Historical `outputBuf` (100 lines) retained** for `session.output` (session-status, backward compat)
4. **`viewportBuf` fully removed** — no more last-N-lines heuristic
5. **Tests** prove: CR-overwrite correctness (overwritten text not visible, final visible text correct), scrolled-off content absent (29 of 50 lines visible), IPC round-trip for viewport snapshot, unreachable endpoint error

## Files Changed
Modified:
- `src/controller/index.ts` — added `@xterm/headless` Terminal (cols=120, rows=30); `feedOutput` writes to terminal; `session.viewport` reads `getViewportSnapshot()` from `terminal.buffer.active`; added `flushViewport()` for write flush; removed `viewportBuf` and `pendingLine`/`emitLine`/`trimBuffers` heuristic logic
- `test/controller-e2e.test.ts` — 4 viewport tests: CR-overwrite correctness, scrolled-off lines absent, IPC round-trip, unreachable endpoint error

New dependencies:
- `@xterm/headless` v6.0.0

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test` -> `0` (254/254 passed)

## Runtime/IPC Validation
- `feedOutput` calls `this.terminal.write(chunk)` — data written asynchronously; `flushViewport()` returns Promise that resolves when xterm has processed all pending data
- `session.viewport` returns `getViewportSnapshot()` which iterates `terminal.buffer.active` rows from `baseY` to `baseY + rows`, trimming empty lines
- `session.output` continues using historical `outputBuf` (100 lines, unchanged) for backward compat
- Old controllers return `METHOD_NOT_FOUND` → actionable "restart with current airelay" message

## Duplicate/Performance Review
- xterm terminal handles ALL ANSI/cursor/screen state — eliminates heuristic line-buffer code
- xterm has 0 runtime dependencies and is well-maintained (xterm.js, 408 versions)
- `flushViewport()` cost: empty write + callback resolution

## Acceptance Criteria Mapping
- `npm test exits 0` — **pass**; evidence: 254/254 pass
- `npm run verify exits 0` — **pass**; evidence: build 0, lint 0, test 254/254
- `Implementation is based on true proxy viewport snapshot, not line-buffer approximation` — **pass**; evidence: `controller/index.ts` uses `@xterm/headless` Terminal which maintains true screen state; `feedOutput` writes raw PTY data to terminal; `getViewportSnapshot()` reads from `terminal.buffer.active` (ANSI-aware, cursor-aware, screen-redraw-aware)
- `Report includes concrete evidence of source-of-truth viewport integration` — **pass**; evidence: xterm terminal initialized at controller construction (`src/controller/index.ts:43-48`); all output routed to it (`feedOutput` line 76); viewport read from it (`getViewportSnapshot` lines 83-93)

## Tests evidence
- **CR-overwrite**: feeds `'Progress: step 1\n'`, `'Progress: step 2...'`, `'\rProgress: DONE!\n'`, `'line 3\n'` → asserts `'Progress: step 2...'` is NOT in viewport (overwritten in place), `'Progress: DONE!'` IS present, `'line 3'` is present
- **Scrolled-off**: feeds 50 lines → asserts viewport has exactly 29 non-empty lines (30-row xterm, 1 cursor line), first visible is `'line 22'`, `'line 0'` and `'line 21'` absent, `'line 49'` present
- **IPC round-trip**: feeds 3 lines, flushes, queries via real IPC socket → asserts all 3 lines found in viewport
- **Unreachable**: queries non-existent socket → asserts error present

## Risks and Follow-ups
- xterm `Terminal.write()` is async (processes on microtask). `flushViewport()` must be called before reading viewport after write. In production, this happens naturally (IPC query latency >> microtask). In tests, `await controller.flushViewport()` is used.
- xterm at 120x30 is a reasonable viewport default. Terminal resize events could update cols/rows dynamically in the future.
- `session-status` continues using historical `session.output` — UI hint detection needs to see hints that may have scrolled off.

## Dependencies
- `@xterm/headless@^6.0.0` (MIT, 0 runtime deps)
