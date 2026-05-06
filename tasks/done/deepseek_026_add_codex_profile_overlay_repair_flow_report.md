# Task Report

## Task ID
`deepseek_026_add_codex_profile_overlay_repair_flow`

## Summary
- Added `repairIsolatedHarnessHome()` function to `src/utils/harness-isolate.ts` that rebuilds a Codex profile overlay from shared `~/.codex` content while preserving isolated `auth.json`
- Integrated repair into `create-interactive.ts` so profile creation always cleans up stale state and rebuilds symlinks
- Integrated repair into `migrate.ts` so legacy codex profiles (from `.aiswitch` rename) are automatically repaired after migration
- Added 5 tests covering: auth.json preservation, stale file removal, missing symlink rebuild, broken symlink replacement, and safety on non-existent directories

## Files Changed
Modified:
- `src/utils/harness-isolate.ts` — added `repairIsolatedHarnessHome(harnessName, profileName, profileDir, baseDir?)` function that: preserves `isolatedItems` (e.g., `auth.json`), removes stale non-isolated entries (files, dirs, wrong symlinks), and rebuilds missing symlinks from the base directory
- `src/commands/create-interactive.ts` — imports and calls `repairIsolatedHarnessHome` after `setupIsolatedHarnessHome` to clean up stale state whenever a profile is created/re-created
- `src/config/migrate.ts` — imports `repairIsolatedHarnessHome`; added `repairLegacyCodexProfiles()` that scans `.airelay` for `codex-<name>` directories and repairs them; called both after a fresh rename migration and when stale `.aiswitch` is detected
- `test/harness-isolate.test.ts` — added `describe('repairIsolatedHarnessHome')` with 5 tests covering the repair behavior

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- harness-isolate init create remove` -> `0` (20/20 passed across 2 suites)
- `npm test` -> `0` (228/228 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — file-system overlay repair; no runtime/IPC changes

## Duplicate/Performance Review
- duplicate code findings: The symlink-creation logic in `repairIsolatedHarnessHome` mirrors the shared-item loop in `setupIsolatedHarnessHome`. ~25 lines duplicated. Extraction into a shared helper would reduce this but would increase the diff; acceptable for now.
- hot-path/performance findings: Repair is called once per profile creation or migration. File-system operations on typically small directories (<50 entries). Acceptable.
- proposed refactors: Extract the shared-item symlink loop into a private `createSharedSymlinks()` function used by both `setupIsolatedHarnessHome` and `repairIsolatedHarnessHome`.

## Acceptance Criteria Mapping
- `A Codex profile overlay can be rebuilt or repaired without losing auth.json` -> pass; evidence: `src/utils/harness-isolate.ts:repairIsolatedHarnessHome` iterates profile entries, skips `config.isolatedItems` (auth.json), removes stale entries, and rebuilds symlinks; `test/harness-isolate.test.ts` verifies auth.json is preserved (file, not symlink, content intact)
- `Shared items are re-symlinked from ~/.codex as needed` -> pass; evidence: repair function loops over `config.sharedItems` after cleanup, creating missing symlinks; tests verify `.json` and `.toml` files are symlinked and broken symlinks are replaced
- `Existing CODEX_HOME layout for codex profiles remains consistent with the intended shared-overlay model` -> pass; evidence: `src/config/migrate.ts` repairs legacy `codex-<name>` directories after migration; `src/commands/create-interactive.ts` repairs on profile creation; both ensure layouts are identical
- `Tests cover the repair/rebuild path and remain green` -> pass; evidence: `test/harness-isolate.test.ts` has 5 repair tests: preserve auth.json, remove stale files, rebuild missing symlinks, replace broken symlinks, safe on missing dir; full suite 228/228

## Risks and Follow-ups
- The repair function uses `fs.rmSync` with `recursive: true` to remove stale directories. This is safe because only non-isolated items are targeted and the function only operates within the `.airelay` profile directory (validated by the caller).

## Roadmap Recommendations
- Consider extracting the shared symlink-creation loop into a utility to eliminate ~25 lines of duplication between `setupIsolatedHarnessHome` and `repairIsolatedHarnessHome`.
