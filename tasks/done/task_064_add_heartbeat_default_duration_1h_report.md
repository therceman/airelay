# Task Report

## Task ID
`task_064_add_heartbeat_default_duration_1h`

## Summary
Added default 1-hour runtime limit to `airelay heartbeat`, plus optional `--duration <ms>` override.

## Files Changed
Modified:
- `src/commands/heartbeat.ts` — added `DEFAULT_DURATION_MS = 1h`, `durationMs` option, `formatDuration()` helper, duration expiry checks after each heartbeat and during interval waits, updated JSDoc
- `src/cli.ts` — added `--duration` flag parsing (positive number validation), usage text, help section
- `test/heartbeat.test.ts` — updated all existing tests to pass `durationMs` (longer than test runtime), added 2 new tests: duration expiry, early SIGINT still works

## Validation Commands
- `npm run build` -> `0`
- `npm run lint` -> `0`
- `npm run format:check` -> `0`
- `npm test` -> `0` (304/304, 27 suites)
- `npm run verify` -> `0` (all stages)

## Acceptance Criteria Mapping
- `airelay heartbeat <session>` exits automatically after 1h — **pass**; evidence: `DEFAULT_DURATION_MS = 3600000`, checked via `Date.now() - startTime >= durationMs` after each heartbeat and during interval waits; test with `durationMs: 15` proves auto-exit
- Existing heartbeat functionality remains intact — **pass**; evidence: all 7 original tests updated and passing; SIGINT/SIGTERM, noWarn, interval, payload format all preserved
- `npm test` exits 0 — **pass**; evidence: 304/304
- `npm run verify` exits 0 — **pass**; evidence: all stages 0

## Flags
- `--duration <ms>` (optional): override runtime limit, default 3600000ms (1h)
