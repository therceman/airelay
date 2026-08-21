# Task 083: Structured IPC message validation reasons

## ID
`task_083_structured_ipc_error_reasons`

## Agent
`Direct implementation`

## Execution Order
`1`

## File Ownership
- `src/types/controller.ts`
- `src/controller/protocol.ts`
- `src/controller/index.ts`
- `src/commands/prompt.ts`
- `src/commands/session-ipc.ts`
- `src/commands/run.ts`
- focused controller and prompt tests under `test/`

## Title
Return structured reasons for invalid Airelay IPC messages

## Scope
- Add stable machine-readable `error.reason` values to IPC error responses.
- Classify malformed JSON, invalid UTF-8, oversized input, unsupported controls,
  invalid Unicode, and empty-after-normalization input.
- Preserve human-readable messages while exposing the reason to CLI callers.

## Non-goals
- No Gateway changes.
- No arbitrary protocol redesign or second message transport.
- No weakening of valid prompt, raw input, or newline-delimited framing behavior.

## Acceptance criteria
- Invalid requests return a structured `error.reason`, not only a generic message.
- `session.input` classifies `too_long`, `unsupported_chars`,
  `invalid_encoding`, and `empty_after_normalization`.
- Malformed JSON and malformed UTF-8 classify as `protocol_parse_error` and
  `invalid_encoding`, respectively.
- CLI prompt errors include the reason when the controller supplies one.
- Tests cover direct parser validation and a real malformed-UTF-8 socket frame.

## Validation
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- `npm audit --audit-level=moderate`

## Reporting Contract (Mandatory)
- Use `tasks/report_stub.md` as the report source and finalize the report in
  `tasks/done/task_083_structured_ipc_error_reasons_report.md`.

## Deliverables
- code changes
- report at `tasks/done/task_083_structured_ipc_error_reasons_report.md`
