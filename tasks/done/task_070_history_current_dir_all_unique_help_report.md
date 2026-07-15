# Task Report

## Task ID
`task_070_history_current_dir_all_unique_help`

## Summary
- Changed `airelay history` to current-directory scope by default and added `--all`.
- Enforced one stored entry per session key.
- Added `airelay history help` and simplified human-readable output.
- Preserved current-directory removal and TUI history behavior.

## Files Changed
- `src/commands/history.ts` — unique-key replacement, default cwd filtering, help, and output format.
- `src/cli.ts` — `--all` and `history help` dispatch/help text.
- `src/commands/select.ts` — uses default current-directory history behavior.
- `test/history.test.ts` — cwd/all filtering, uniqueness, output, and help tests.
- `test/cli-runCli.test.ts` — `--all` and history-help dispatch tests.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test` -> `0` (`29` suites, `329` tests)
- `npm run verify` -> `0`

## Runtime/IPC Validation (if applicable)
- Default `historyCommand()` filtered to `process.cwd()`.
- `historyCommand({ all: true })` included entries from multiple directories.
- Human output emitted the context line followed by `> airelay ...`, with no `started:` line.
- No controller or IPC behavior changed.

## Duplicate/Performance Review
- duplicate code findings: none; filtering and output remain centralized in `history.ts`.
- hot-path/performance findings: none.
- proposed refactors: none

## Acceptance Criteria Mapping
- Default history is current-directory-only -> `pass`; evidence: `history.test.ts` default listing test.
- `--all` lists every directory -> `pass`; evidence: `history.test.ts` all-directory test and CLI dispatch test.
- History is unique by session key -> `pass`; evidence: replacement logic and uniqueness test.
- Help documents behavior and remove -> `pass`; evidence: `historyHelpCommand` and help test.
- Output omits `started:` and uses `> airelay ...` -> `pass`; evidence: output assertions in `history.test.ts`.
- Full verification passes -> `pass`; evidence: `npm run verify`, `29` suites and `329` tests.

## Risks and Follow-ups
- Reusing a key moves its single history entry to the newest launch, including its newest invocation directory.

## Roadmap Recommendations
- none

## Completion Notification
- After final report rename, notify manager:
  - `airelay prompt gpt_master_airelay "task_070_history_current_dir_all_unique_help_done"`
