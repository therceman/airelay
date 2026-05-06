# Task Report

## Task ID
`deepseek_030_codex_profile_prompt_submit_ctrl_j_default`

## Summary
- Implemented profile-aware default submit semantics for prompt injection: Codex-based profiles use `\n` (Ctrl+J, 0x0A) as the submit byte by default, while other profiles continue to use `\r` (Enter, 0x0D)
- The `enter` field in the IPC protocol changed from a boolean to a string (the submit byte) or boolean `false` (no submit)
- Harness detection uses `detectHarness()` on the profile's executable from config — no hardcoded profile names
- Explicit `enter: false` or string overrides continue to work

## Files Changed
Modified:
- `src/types/controller.ts` — `SessionInputParams.enter` changed from `boolean` to `string | boolean`; JSDoc documents `"\r"` (Enter) and `"\n"` (Ctrl+J) semantics
- `src/commands/prompt.ts` — imports `loadConfig` and `detectHarness`; after resolving session, loads config to find profile executable, detects harness, and chooses submit byte: `"\n"` for codex, `"\r"` for opencode/unknown; caller-provided `enter` option (boolean or string) takes precedence over harness detection
- `src/commands/run.ts` — controller handler reads `params.enter` as `string | boolean`; if it's a string, uses it directly as the submit byte; if `true` (boolean), uses `"\r"` as default fallback; if `false` or absent, sends no submit byte
- `test/prompt.test.ts` — updated `includes enter:true by default` test to expect `enter:"\\r"` (the JSON string representation of `"\r"`) instead of `enter:true`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- prompt controller run` -> `0` (87/87 passed across 6 suites)
- `npm test` -> `0` (228/228 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
- Codex profile default: `prompt.ts` detects harness from config → `enter: "\n"` sent in IPC request → `run.ts` handler writes `\n` (Ctrl+J) to PTY
- Opencode profile default: `prompt.ts` detects harness → `enter: "\r"` sent → `run.ts` handler writes `\r` (Enter) to PTY
- Explicit `enter: false`: passed through as boolean `false` → handler skips submit byte
- Explicit string override: passed through directly → handler uses provided byte

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: `promptCommand` now calls `loadConfig()` which reads file from disk (~1-5ms). Acceptable for a command that connects over IPC (5000ms timeout).
- proposed refactors: none

## Acceptance Criteria Mapping
- `Codex session default prompt submit behaves as Ctrl+J semantics` -> pass; evidence: `src/commands/prompt.ts:112` sets `submitByte = '\n'` when harness is `'codex'`; `src/commands/run.ts:72` writes the submit byte directly to the PTY; harness detection uses `detectHarness(profile.executable)` (`src/utils/harness.ts:8-16`)
- `Non-Codex default behavior remains unchanged` -> pass; evidence: `src/commands/prompt.ts:113` sets `submitByte = '\r'` for harnesses other than codex; this matches the previous hardcoded `\r` in the PTY path; full suite 228/228 passes with no regressions
- `Explicit overrides continue to work` -> pass; evidence: `src/commands/prompt.ts:99-102` checks `callerEnter` first — `false` bypasses submit, string is used directly; `test/prompt.test.ts` verifies `enter:false` is passed correctly
- `Build/lint/tests pass` -> pass; evidence: build (0), lint (0), full suite 228/228

## Risks and Follow-ups
- The `enter` field type changed from `boolean` to `string | boolean`. The IPC protocol between the prompt client and the controller handler is internal to airelay (both sides are in the same codebase), so this is a safe change. Both sides were updated in this task.
- `loadConfig()` is called for every `prompt` invocation. This adds ~1-5ms of file I/O. For a command with a 5000ms IPC timeout, this is negligible.

## Roadmap Recommendations
- none
