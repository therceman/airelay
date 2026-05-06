# Task Report

## Task ID
`deepseek_011_fix_tty_regression_for_interactive_resume`

## Summary
- Fixed TTY regression where `onChildSpawn` callback presence forced piped stdin even in non-pipe mode, breaking TTY-sensitive harnesses like codex
- Decoupled `pipeStdin` from `onChildSpawn` in `spawnAndWait` — stdio mode is now controlled solely by the explicit `pipeStdin` option, not by callback presence
- Simplified `run.ts`: only passes `onChildSpawn` when `pipeStdin` is true; non-pipe mode uses pure `inherit` stdio
- Added actionable error when `prompt` targets a session using inherited TTY stdin (non-pipe sessions)

## Files Changed
- `src/runtime/spawn.ts` — added `pipeStdin?: boolean` to `SpawnOptions`; changed stdio decision from `options.onChildSpawn ? ['pipe',...] : 'inherit'` to `options.pipeStdin ? ['pipe',...] : 'inherit'`; `onChildSpawn` fires regardless of stdio mode
- `src/commands/run.ts` — imported `IpcError`/`IpcErrorCodes`; controller `session.input` handler now throws `IpcError` with actionable message when `childStdin` is null (non-pipe sessions); `spawnAndWait` call only includes `onChildSpawn` when `pipeStdin` is true; passes `pipeStdin` option to `spawnAndWait`
- `test/spawn.test.ts` — added 2 tests: `uses inherit stdio when pipeStdin is not set (TTY-compatible)` verifies `child.stdin` is null in inherit mode; `provides writable stdin when pipeStdin is true` verifies `child.stdin` is a stream in pipe mode

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- run resume spawn prompt` -> `0` (53/53 passed across 4 suites)
- `npm test` -> `0` (209/209 passed across 22 suites)

## Runtime/IPC Validation (if applicable)
- behavior verification notes:
  - Default (no `pipeStdin`): `spawnAndWait` uses `stdio: 'inherit'` → child inherits parent TTY → `child.stdin` is null → `session.input` handler throws `IpcError` → prompt shows actionable error
  - `pipeStdin: true` (start command): `spawnAndWait` uses `stdio: ['pipe', 'inherit', 'inherit']` → `child.stdin` is writable → `session.input` handler writes text → prompt succeeds

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `airelay <profile> resume <id> and airelay <profile> -s <id> passthrough paths no longer force non-terminal stdin for interactive runtimes` -> pass; evidence: `src/runtime/spawn.ts:61` uses `options.pipeStdin` (not `options.onChildSpawn`) for stdio decision; `src/commands/run.ts` only passes `onChildSpawn` when `pipeStdin` is true; non-pipe profiles use pure `inherit` stdio
- `TTY-sensitive harnesses (e.g., codex) can launch without stdin is not a terminal failure caused by airelay` -> pass; evidence: default `runCommand` call (from `resume.ts`, `select.ts`, CLI `run`) does NOT set `pipeStdin` → `spawnAndWait` uses `stdio: 'inherit'` → child sees real TTY; `test/spawn.test.ts` verifies `child.stdin` is null in inherit mode
- `Existing non-interactive/test flows remain green` -> pass; evidence: full suite 209/209 passes (all existing tests unchanged)
- `Prompt-control behavior is either preserved or explicitly degraded with clear messaging in TTY-only mode` -> pass; evidence: `src/commands/run.ts:57-66` throws `IpcError` with message `Prompt injection unavailable: this session uses inherited terminal input. Use "airelay start <profile>" for prompt-capable sessions.` when `childStdin` is null; `test/prompt.test.ts` tests confirm error responses surface correctly

## Risks and Follow-ups
- none — all acceptance criteria met

## Roadmap Recommendations
- none — task 11 is complete
