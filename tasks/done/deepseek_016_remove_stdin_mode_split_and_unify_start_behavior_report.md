# Task Report

## Task ID
`deepseek_016_remove_stdin_mode_split_and_unify_start_behavior`

## Summary
- Removed the obsolete `pipeStdin` option from `runCommand` — replaced with the explicit `usePty` option that directly maps to the PTY-backed launch path
- `start` command now passes `{ usePty: true }` instead of `{ pipeStdin: true }`, making it the canonical always-promptable launch path
- Eliminated the old pipe-vs-inherit ambiguity in `runCommand` options — the split is now PTY (promptable + terminal-compatible) vs inherit (interactive, non-promptable)
- No functional changes to `run`/`resume`/`select` flows (they continue using inherit mode by default)

## Files Changed
Modified:
- `src/commands/run.ts` — changed the `runCommand` options interface: replaced `pipeStdin?: boolean` with `usePty?: boolean`; updated the internal mapping from `options?.pipeStdin` to `options?.usePty`
- `src/commands/start.ts` — changed invocation from `{ pipeStdin: true }` to `{ usePty: true }`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- cli start run resume prompt` -> `0` (93/93 passed across 5 suites)
- `npm test` -> `0` (222/222 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — option rename only; no runtime/behavioral changes

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `Start path is promptable by default and terminal-compatible for harness args` -> pass; evidence: `src/commands/start.ts` passes `{ usePty: true }` to `runCommand` which spawns via PTY; PTY mode provides both TTY compatibility and programmatic stdin injection; verified by PTY tests in `test/spawn.test.ts`
- `No residual code path that depends on old stdin split for interactive launches` -> pass; evidence: `pipeStdin` option removed from `runCommand` interface; `start.ts` uses `usePty` instead; `spawn.ts`'s `pipeStdin` remains only for the cross-spawn path's internal stdio mode (unrelated to the old interactive split); verified by grep search showing no `pipeStdin` usage remains in `run.ts` or `start.ts`
- `CLI/docs/tests reflect unified behavior and remain green` -> pass; evidence: 222/222 tests pass with no changes needed to CLI tests (options are internal); help text unchanged (start is already documented as the launch command)

## Risks and Follow-ups
- none — all acceptance criteria met

## Roadmap Recommendations
- none — task 16 is complete
