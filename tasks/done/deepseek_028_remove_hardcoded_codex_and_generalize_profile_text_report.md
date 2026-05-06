# Task Report

## Task ID
`deepseek_028_remove_hardcoded_codex_and_generalize_profile_text`

## Summary
- Removed hardcoded `Codex` product branding from global CLI help text and high-level README description — replaced with profile-agnostic terms ("shared-base profile overlays", "harness instances")
- Updated `isolate` and `remove` command messages to use executable-aware phrasing ("profiles with codex executable") instead of product-branded "Codex profiles"
- Kept `codex` references only where technically required: `CODEX_HOME` env var, `~/.codex` base directory paths, `executable === 'codex'` runtime checks, and harness-config entries
- Verified no stale hardcoded product-language fragments remain via `rg -n 'hardcoded codex|Codex profile overlay|codex-only'`

## Files Changed
Modified:
- `src/cli.ts` — description: "shared-base Codex profile overlays" → "shared-base profile overlays"; `isolate` help: "Show/set up Codex profile shared-base overlay" → "Show/set up overlay for codex executable profiles"; `remove` help: "Remove Codex profile overlay" → "Remove profile overlay"
- `src/commands/isolate.ts` — "No Codex profiles found" → "No profiles with codex executable found"; "Codex profiles:" → "Profiles with codex executable:"; "not a Codex profile" → "executable is not 'codex'"; "Codex profile 'X' now uses" → "Profile 'X' (codex) now uses"
- `src/commands/remove.ts` — "No Codex overlay profiles found" → "No overlay profiles for codex executable found"; "Codex overlay profiles" → "Overlay profiles (codex executable)"; "not a Codex profile" → "executable is '...', not 'codex'"; "shared Codex home" → "shared codex home"
- `README.md` — high-level description: "profile-isolated OpenCode/Codex instances" → "harness instances with shared-base overlay support"

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- cli create isolate remove` -> `0` (87/87 passed across 4 suites)
- `npm test` -> `0` (228/228 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — user-facing text and help only; no runtime/IPC behavior changed

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `rg -n "hardcoded codex|Codex profile overlay|codex-only" src README.md returns no stale hardcoded product-language fragments` -> pass; evidence: `rg` search returned zero matches after changes (verified via bash)
- `High-level CLI/README copy is profile-agnostic` -> pass; evidence: `src/cli.ts` description ("shared-base profile overlays"), `README.md` description ("harness instances with shared-base overlay support"), `src/cli.ts` help text for isolate/remove (no product branding)
- `Codex-specific references remain only where technically required` -> pass; evidence: `src/utils/harness-isolation.ts` (config entries, `defaultBaseDir: '~/.codex'`), `src/utils/harness.ts` (HarnessType, session patterns), `src/commands/init.ts` (executable detection, CODEX_HOME), `src/commands/which.ts` (env filtering), `src/commands/create-interactive.ts` (codex-specific env handling), `src/commands/remove.ts` (CODEX_HOME validation), `src/commands/isolate.ts` (executable === 'codex' check), `src/config/migrate.ts` (codex-<name> directory matching), `src/config/defaults.ts` (example profiles)
- `Build/lint/tests all pass` -> pass; evidence: build (0), lint (0), full test suite 228/228

## Risks and Follow-ups
- none — surgical text-only changes; no behavioral impact

## Roadmap Recommendations
- none
