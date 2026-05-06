# Task Report

## Task ID
`deepseek_031_replace_prompt_submit_hardcoding_with_harness_capabilities`

## Summary
- Replaced hardcoded `harness === 'codex' ? '\n' : '\r'` branching in `prompt.ts` with a declared capabilities model in `harness.ts`
- Added `HarnessCapabilities` interface with `defaultSubmitByte: '\r' | '\n'` field
- Added `HARNESS_CAPABILITIES` map and `getHarnessCapabilities(harness)` resolver
- prompt submit logic now calls `getHarnessCapabilities(harness).defaultSubmitByte` — extensible without code changes for new harnesses

## Files Changed
Modified:
- `src/utils/harness.ts` — added `HarnessCapabilities` interface (`defaultSubmitByte`), `HARNESS_CAPABILITIES` record mapping each `HarnessType` to its capabilities, and `getHarnessCapabilities(harness)` resolver function; unknown harness defaults to `'\r'` for broadest compatibility
- `src/commands/prompt.ts` — imports `getHarnessCapabilities` alongside `detectHarness`; replaced `harness === 'codex' ? '\n' : '\r'` ternary with `getHarnessCapabilities(harness).defaultSubmitByte`

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- prompt controller run` -> `0` (87/87 passed across 6 suites)
- `npm test` -> `0` (228/228 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
- Capability-driven behavior identical to previous hardcoded branching:
  - `codex` → `HARNESS_CAPABILITIES.codex.defaultSubmitByte` = `'\n'`
  - `opencode` → `HARNESS_CAPABILITIES.opencode.defaultSubmitByte` = `'\r'`
  - `unknown` → `HARNESS_CAPABILITIES.unknown.defaultSubmitByte` = `'\r'`

## Duplicate/Performance Review
- duplicate code findings: none — capabilities model is the single source of truth
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `No direct hardcoded harness-name branching for submit byte in prompt.ts` -> pass; evidence: `src/commands/prompt.ts:108` calls `getHarnessCapabilities(harness).defaultSubmitByte`; `grep` confirms zero matches for `harness === .codex` or `codex.*harness` in `prompt.ts`
- `Submit decision is capability-driven from one source of truth` -> pass; evidence: `src/utils/harness.ts` defines `HarnessCapabilities` interface, `HARNESS_CAPABILITIES` map, and `getHarnessCapabilities()` resolver — the sole location where submit byte per harness is declared
- `Existing behavior remains intact for codex/opencode` -> pass; evidence: codex → `'\n'` (Ctrl+J), opencode → `'\r'` (Enter), unknown → `'\r'` (Enter); identical to previous hardcoded logic; full suite 228/228 passes
- `Build/lint/tests pass` -> pass; evidence: build (0), lint (0), full suite 228/228

## Risks and Follow-ups
- Adding a new harness requires adding it to `HarnessType` union type AND to `HARNESS_CAPABILITIES` map — the type system ensures both are updated
- Future capabilities (e.g., `usesAlternateBuffer`) can be added to the `HarnessCapabilities` interface without changing any consumer code

## Roadmap Recommendations
- none
