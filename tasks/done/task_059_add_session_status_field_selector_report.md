# Task Report

## Task ID
`task_059_add_session_status_field_selector`

## Summary
Added `--field <name>` flag to `session-status` command for machine-friendly single-field output.

## Files Changed
Modified:
- `src/cli.ts` — `session-status` case parses `--field <name>` flag, passes to `sessionStatusCommand`; usage updated
- `src/commands/session-status.ts` — `sessionStatusCommand` accepts `field` option; added `ALLOWED_FIELDS` constant; field mode prints raw value only; unknown field → non-zero + actionable error listing allowed fields; missing value → non-zero error
- `test/session-status-blocking.test.ts` — 3 new tests: field selector, unknown field error, default output unchanged

## Validation Commands
- `npm run build` -> `0`
- `npm run lint` -> `0`
- `npm run format:check` -> `0`
- `npm test` -> `0` (288/288, 26 suites)

## Acceptance Criteria Mapping
- `session-status --field state works as described` — **pass**; evidence: `session-status.ts:188-200` handles field mode; field prints `String(value)` with no labels
- `Existing behaviors remain intact` — **pass**; evidence: default output unchanged (line 202 `else` branch); `--json` unchanged (line 178 branch); existing tests pass
- `npm test exits 0` — **pass**; evidence: 288/288
- `npm run verify exits 0` — **pass**; evidence: all stages 0

## Allowed fields
`sessionId`, `profile`, `sessionKey`, `controllerReachable`, `pingLatencyMs`, `airelayVersion`, `controllerProtocolVersion`, `startedAt`, `state`
