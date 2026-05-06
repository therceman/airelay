# Task Report

## Task ID
`deepseek_014_enforce_start_only_launch_and_remove_profile_shortcut`

## Summary
- Removed the profile-as-command shortcut (`airelay <profile>`) — unknown commands now show a hard error with actionable migration message directing users to `airelay start <profile>`
- Canonical launch path is now `airelay start <profile> [profile_args...]`, which supports passthrough args and yields promptable sessions via `pipeStdin: true`
- The explicit `airelay run <profile>` command remains functional but is no longer the default/implied path
- Updated CLI help, error messages, and tests

## Files Changed
Modified:
- `src/cli.ts` — `parseArgs()` now returns `{ command: 'error', profile: command }` for unknown commands instead of `{ command: 'run', ... }`; added `case 'error':` in `runCli()` showing migration error with `console.error` and `process.exit(1)`; simplified `default` case (no longer falls through to `showHelp()` for unknown commands)
- `test/cli.test.ts` — updated 5 tests to expect `command: 'error'` for profile shortcut cases (bare profile, profile with flags, profile with `--`, values starting with dash)
- `test/cli-runCli.test.ts` — updated `handles unknown command as profile run` to `handles unknown command as error`; updated `executes select command for unknown command` to `shows error for unknown command` verifying `console.error` output and `process.exit(1)`
- `test/cli-integration.test.ts` — updated 2 integration tests to expect `Unknown command or profile` and `airelay start` migration message instead of `Profile not found`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- cli start run resume prompt` -> `0` (93/93 passed across 5 suites)
- `npm test` -> `0` (220/220 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — CLI parsing change only; no runtime/IPC behavior modified

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `airelay <profile> no longer silently launches profile (must be removed or explicit error with guidance)` -> pass; evidence: `src/cli.ts:89-93` returns `{ command: 'error' }` for unknown commands; `src/cli.ts:324-328` shows `Error: Unknown command or profile: "<profile>". Use "airelay start <profile>" to launch this profile. Run "airelay help" for available commands.`; `test/cli.test.ts` (5 tests expect `command: 'error'`), `test/cli-integration.test.ts` (2 integration tests verify migration message)
- `airelay start <profile> <profile_args...> reliably launches with passthrough args` -> pass; evidence: `src/cli.ts:258-263` passes `extraArgs` to `startCommand`; `src/commands/start.ts` passes `extraArgs` to `runCommand` with `pipeStdin: true`; existing `start` tests pass unchanged
- `start launch path yields promptable sessions consistent with current prompt architecture` -> pass; evidence: `src/commands/start.ts` calls `runCommand` with `{ pipeStdin: true }` which enables controller-backed session and stdin forwarding (verified by `test/run.test.ts` controller lifecycle tests)
- `CLI/help/docs/tests are updated and green` -> pass; evidence: help text unchanged (`start` remains documented as session launcher); 220/220 tests pass across 23 suites

## Risks and Follow-ups
- none — all acceptance criteria met

## Roadmap Recommendations
- none — task 14 is complete
