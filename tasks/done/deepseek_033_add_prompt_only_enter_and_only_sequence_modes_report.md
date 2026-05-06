# Task Report

## Task ID
`deepseek_033_add_prompt_only_enter_and_only_sequence_modes`

## Summary
- Added `--only-enter` and `--only-sequence <seq>` flags to `airelay prompt` for submit-only and raw sequence-only prompt modes
- `--only-enter` sends the harness-default submit byte (Enter for opencode, CSI-u for codex) with no text — useful for triggering submit in an active session
- `--only-sequence <seq>` sends the provided raw byte sequence directly as the submit value with no text — useful for sending arbitrary terminal sequences
- Mutual exclusivity validation: `--only-enter` and `--only-sequence` cannot be combined, neither can be combined with a text argument
- Backward compatible: `--sequence` still accepted as an alias for `--only-sequence`, `sequence=...` positional arg still works
- Updated help text and examples

## Files Changed
Modified:
- `src/commands/prompt.ts` — added `PromptOptions` interface with `onlyEnter` and `onlySequence` fields; `promptCommand` now accepts empty text when `--only-enter` or `--only-sequence` is used; submit byte selection prioritizes `onlySequence` > `onlyEnter` (harness default) > explicit `enter` > harness default
- `src/cli.ts` — prompt case parses `--only-enter`, `--only-sequence`, and legacy `--sequence`/`sequence=` flags; validates mutual exclusivity (only-enter + only-sequence, text + mode flag); passes new options to `promptCommand`; updated help text with new options and examples
- `test/cli-runCli.test.ts` — replaced old `--sequence override` and `sequence=...` tests with `--only-sequence` and `--only-enter` tests verifying correct option propagation to `promptCommand`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- cli-runCli prompt` -> `0` (40/40 passed across 2 suites)
- `npm test` -> `0` (231/231 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
- `--only-enter`: `prompt.ts` resolves harness capabilities to get `caps.submitValue`, sends empty text + submit + delay
- `--only-sequence <seq>`: `prompt.ts` uses the provided sequence string directly as the `enter` param, sends empty text + submit + delay
- Both modes still respect `TEXT_TO_SUBMIT_DELAY_MS` (500ms delay between text write and submit write)

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `airelay prompt <session> --only-enter works and does not require text` -> pass; evidence: `src/commands/prompt.ts:86-87` allows empty text when `onlyEnter` is true; `src/cli.ts:333-336` validates and passes `onlyEnter: true`; `test/cli-runCli.test.ts` verifies `promptCommand` called with `onlyEnter: true, onlySequence: undefined`
- `airelay prompt <session> --only-sequence $'...' sends provided sequence directly and does not require text` -> pass; evidence: `src/commands/prompt.ts:97-99` sets `submitByte = onlySequence` directly; `src/cli.ts:333-336` passes `onlySequence` from `--only-sequence` or legacy `--sequence`/`sequence=`; `test/cli-runCli.test.ts` verifies `onlySequence` value propagated correctly
- `Invalid combos produce actionable errors` -> pass; evidence: `src/cli.ts:330-338` checks `onlyEnter && onlySequence` (cannot combine) and `(onlyEnter || onlySequence) && text` (cannot combine with text), exits with code 1 and descriptive message
- `Existing text prompt behavior remains intact` -> pass; evidence: full suite 231/231 passes; no changes to default text + submit path in `promptCommand`
- `Build/lint/tests pass` -> pass; evidence: build (0), lint (0), full suite 231/231

## Risks and Follow-ups
- The `--sequence` flag is kept as a backward-compatible alias for `--only-sequence`. When used with text, it's treated as `--only-sequence` (text is ignored). This is a minor behavior change from the old `--sequence` which used to override the enter value while still sending text. The new behavior is documented in help text.

## Roadmap Recommendations
- none
