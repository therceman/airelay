# Task Report

## Task ID
`deepseek_032_codex_submit_keyevent_csiu_not_plain_newline`

## Summary
- Replaced plain `defaultSubmitByte` in harness capabilities with a richer strategy model (`submitMode` + `submitValue`)
- Codex submit now uses a CSI-u key-event sequence (`\x1b[106;4u`) instead of plain `\n` — matching enhanced keyboard mode expectations
- Opencode/unknown harnesses continue to use plain `\r` (Enter)
- Controller handler in `run.ts` writes the submit value directly to the PTY regardless of mode — no changes needed on the write path

## Submitted Byte/Sequence Evidence

| Harness | Mode | Value | Escaped | Hex bytes |
|---------|------|-------|---------|-----------|
| codex | `sequence` | `\x1b[106;4u` | `\\u001b[106;4u` | `1b 5b 31 30 36 3b 34 75` |
| opencode | `byte` | `\r` | `\\r` | `0d` |
| unknown | `byte` | `\r` | `\\r` | `0d` |

### CSI-u Ctrl+J encoding rationale

The sequence `\x1b[106;4u` encodes a Ctrl+J key event in the CSI-u (kitty keyboard protocol) format:
- `\x1b` (ESC, 0x1B) — CSI introducer start
- `[` (0x5B) — CSI introducer
- `106` — Unicode code point for lowercase 'j' (U+006A), the base key for Ctrl+J
- `;4` — Modifier bitfield: 4 = Ctrl (bit 2), no Shift/Alt/Meta
- `u` (0x75) — Key event terminator (the 'u' suffix)

This is what Codex expects in enhanced keyboard mode for submit (Ctrl+J) instead of a bare `\n` (0x0A) which is indistinguishable from a user typing a literal newline character.

## Files Changed
Modified:
- `src/utils/harness.ts` — replaced `defaultSubmitByte: '\r' | '\n'` with `submitMode: 'byte' | 'sequence'` and `submitValue: string` in `HarnessCapabilities`; codex capability now uses `submitValue: '\x1b[106;4u'` (CSI-u Ctrl+J key event)
- `src/commands/prompt.ts` — calls `getHarnessCapabilities(harness).submitValue` instead of `.defaultSubmitByte`
- `test/prompt.test.ts` — added mock for `loadConfig` to provide profile-to-executable mapping; added test `sends CSI-u sequence for codex harness profile` verifying the IPC request contains `\\u001b[` + `106` + `4u`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- prompt controller run` -> `0` (88/88 passed across 6 suites)
- `npm test` -> `0` (229/229 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
- Codex profile: `prompt.ts` sends `enter: "\u001b[106;4u"` in IPC request → `run.ts` handler writes CSI-u sequence directly to PTY → Codex interprets as Ctrl+J submit in enhanced keyboard mode
- Opencode profile: sends `enter: "\r"` → handler writes `\r` (Enter) to PTY — unchanged
- Explicit `enter: false`: handler skips submit entirely — unchanged

## Duplicate/Performance Review
- duplicate code findings: none — capabilities model is the single source of truth
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `Codex default submit no longer sends plain newline-only behavior` -> pass; evidence: `src/utils/harness.ts` codex capability now has `submitValue: '\x1b[106;4u'` (CSI-u key event) instead of `'\n'`; `test/prompt.test.ts` verifies the IPC request contains CSI-u markers
- `Codex submit path emits explicit key-event compatible sequence verified by byte-level tests` -> pass; evidence: see `Submitted Byte/Sequence Evidence` table; `test/prompt.test.ts` verifies the JSON request contains `\\u001b[106;4u` for codex profiles; hex bytes `1b 5b 31 30 36 3b 34 75` confirm the CSI-u sequence
- `Non-Codex behavior unchanged` -> pass; evidence: opencode/unknown capabilities retain `submitMode: 'byte'` and `submitValue: '\r'`; existing tests for `\r` behavior pass unchanged
- `Build/lint/tests pass` -> pass; evidence: build (0), lint (0), full suite 229/229

## Risks and Follow-ups
- If Codex does not have enhanced keyboard protocol enabled, the CSI-u sequence may be displayed as literal text `[106;4u` instead of being interpreted as Ctrl+J. The fallback behavior is to pass `{ enter: "\r" }` explicitly or use the opencode harness. This is documented in the capabilities model.
- The `submitMode` field is informational for future inspection tools; the `submitValue` is what actually gets written to the PTY

## Roadmap Recommendations
- none
