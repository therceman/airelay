# Task Report

## Task ID
`task_068_add_tui_profile_session_history_entry`

## Summary
- Added `Show profile session history` to the main `airelay` TUI menu.
- Placed it after Resume when active sessions exist and before Start/Create.
- Kept it available without active sessions and routed it to current-directory history output.
- Added selector ordering tests.

## Files Changed
- `src/commands/select.ts` — added main choice construction and Show action routing.
- `test/select.test.ts` — verified menu ordering with and without active sessions.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test` -> `0` (`29` suites, `323` tests)
- `npm run verify` -> `0`

## Runtime/IPC Validation (if applicable)
- Show routes to `historyCommand({ cwd: true })` and returns before profile selection.
- No harness launch, controller, or IPC behavior was changed.

## Duplicate/Performance Review
- duplicate code findings: none; menu construction is centralized in `buildMainChoices`.
- hot-path/performance findings: none.
- proposed refactors: none

## Acceptance Criteria Mapping
- Menu order with active sessions is Resume, Show, Start, Create -> `pass`; evidence: `buildMainChoices(true)` test in `test/select.test.ts`.
- Menu order without active sessions is Show, Start, Create -> `pass`; evidence: `buildMainChoices(false)` test in `test/select.test.ts`.
- Show lists current-directory history without launching a profile -> `pass`; evidence: Show branch in `src/commands/select.ts` calls `historyCommand({ cwd: true })` and returns.
- Existing behavior remains compatible -> `pass`; evidence: full `npm run verify`, `29` suites and `323` tests.

## Risks and Follow-ups
- none

## Roadmap Recommendations
- none

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_068_add_tui_profile_session_history_entry_done"`
