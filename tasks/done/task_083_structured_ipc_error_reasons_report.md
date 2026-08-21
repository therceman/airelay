# Task Report

## Task ID
`task_083_structured_ipc_error_reasons`

## Summary
- Added stable `error.reason` values to the existing IPC error envelope.
- Added bounded `session.input` validation for size, Unicode, controls, and
  normalization failures.
- Added fatal UTF-8 decoding at the controller socket boundary so malformed
  bytes cannot silently become replacement characters.
- CLI prompt errors now display the machine-readable reason.

## Files Changed
- `src/types/controller.ts` — reason constants and optional IPC error field.
- `src/controller/protocol.ts` — request validation and protocol reasons.
- `src/controller/index.ts` — strict UTF-8 socket decoding and reason propagation.
- `src/commands/prompt.ts` — reason-aware human-readable error output.
- `src/commands/session-ipc.ts` — typed reason propagation for controller clients.
- `src/commands/run.ts` — structured reasons for unavailable PTY/prompt mode.
- `test/controller-protocol.test.ts` — reason classification and response tests.
- `test/controller-e2e.test.ts` — malformed UTF-8 real socket regression.
- `test/prompt.test.ts` — CLI output regression.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm run -s format:check` -> `0`
- `npm test -- --runInBand` -> `0` (37 suites, 428 tests)
- `npm audit --audit-level=moderate` -> `0` (0 vulnerabilities)

## Runtime/IPC Validation (if applicable)
- command transcript snippets: malformed UTF-8 socket frame returned an error
  response containing `reason: "invalid_encoding"`.
- behavior verification notes: malformed JSON returns
  `reason: "protocol_parse_error"`; prompt CLI renders
  `Error: IPC error from controller [reason=too_long]: ...`.

## Duplicate/Performance Review
- duplicate code findings: none; reason propagation reuses the existing IPC
  error envelope and controller response helper.
- hot-path/performance findings: validation is bounded by the 256 KiB input cap;
  fatal decoding avoids replacement-character reprocessing.
- proposed refactors: none.

## Acceptance Criteria Mapping
- Structured `error.reason` is returned -> `pass`; controller protocol/types tests.
- `too_long` -> `pass`; `MAX_SESSION_INPUT_BYTES` regression.
- `unsupported_chars` -> `pass`; control-character regression.
- `invalid_encoding` -> `pass`; surrogate and real socket byte regressions.
- `empty_after_normalization` -> `pass`; whitespace input regression.
- `protocol_parse_error` -> `pass`; malformed JSON regression.
- CLI exposes reason without losing message -> `pass`; `test/prompt.test.ts`.

## Risks and Follow-ups
- Existing clients that only read `error.code` and `error.message` remain
  compatible because `reason` is optional.

## Roadmap Recommendations
- Future IPC consumers should branch on `error.reason`, not parse human text.

## Completion Notification
- Direct implementation; no worker notification is sent.
