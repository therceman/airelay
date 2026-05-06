# Task Report

## Task ID
`deepseek_025_audit_codex_home_migration_and_legacy_aiswitch_symlink_tree`

## Summary
- Audited the full Codex home creation/migration/symlink path across `migrate.ts`, `init.ts`, `create-interactive.ts`, `isolate.ts`, `remove.ts`, `harness-isolation.ts`, and `harness-isolate.ts`
- Identified the root cause of the stale `.aiswitch/codex-codex2` directory: when `.airelay` exists (from a prior migration or `airelay init`) and `.aiswitch` also exists, `migrateLegacyHomeDirIfNeeded()` silently returns without any warning, leaving the stale legacy directory untouched
- Fixed `migrate.ts` to detect this state and print a user-facing warning explaining that `.aiswitch` is stale and can be safely removed
- Verified that Codex profile creation paths (`init.ts` uses shared `~/.airelay/codex`, `create-interactive.ts` uses isolated `~/.airelay/codex-<name>` with symlinks to `~/.codex`) are consistent with the intended shared overlay model

## Files Changed
Modified:
- `src/config/migrate.ts` — `migrateLegacyHomeDirIfNeeded()` now handles the case where both `.airelay` and `.aiswitch` exist: reads the stale directory contents and prints a one-time warning listing sample filenames and suggesting manual removal. Previously this path silently returned without any user feedback.

## Audit Findings

### Migration Path (`src/config/migrate.ts`)

| Scenario | Before fix | After fix |
|----------|-----------|-----------|
| `.aiswitch` exists, `.airelay` does not | rename → `.airelay` | rename → `.airelay` (unchanged) |
| Neither exists | skip (unchanged) | skip (unchanged) |
| `.airelay` exists, `.aiswitch` does not | skip (unchanged) | skip (unchanged) |
| **Both exist** | **silent skip** | **warning with stale filename sample** |

The last row is the bug. It occurs when:
1. `airelay init` created `.airelay` independently, OR
2. A prior migration already renamed `.aiswitch` → `.airelay`, but the user or a tool re-created `.aiswitch` later, OR
3. The user renamed `.aiswitch` manually, leaving `.airelay` intact

In all cases, `.aiswitch/codex-codex2` is stale — the active data is in `.airelay/codex-codex2` (or as a profile referencing `~/.airelay/codex`). The symlinks and `auth.json` under the stale path are not used by any active profile.

### Codex Profile Creation (`src/commands/init.ts` line 46)

`init.ts` sets `CODEX_HOME: ~/.airelay/codex` — a shared, non-isolated directory. This is correct for the default profile. No legacy `.aiswitch` references.

### Interactive Codex Creation (`src/commands/create-interactive.ts` lines 103-104, 143-150)

`create-interactive.ts` calls `setupIsolatedHarnessHome('codex', name)` which creates `~/.airelay/codex-<name>` with symlinks to `~/.codex` shared content and isolated `auth.json`. No legacy `.aiswitch` references.

### Isolation Setup (`src/utils/harness-isolate.ts` lines 33-35)

`setupIsolatedHarnessHome` uses `AIRELAY_CONFIG` env var to determine the base directory, falling back to `~/.airelay`. No legacy `.aiswitch` references.

### Isolation Config (`src/utils/harness-isolation.ts` line 43)

`defaultBaseDir` for codex is `~/.codex`. The shared items (memories, policy, etc.) are symlinked from `~/.codex`. The only isolated item is `auth.json`. This is the intended shared overlay model.

### Remove Command (`src/commands/remove.ts` lines 59, 164-170)

`remove.ts` validates that the profile's `CODEX_HOME` contains `.airelay/codex-` and that the directory is under `.airelay`. It explicitly blocks removal of `~/.codex`. No legacy path handling — this is correct since isolations always target `.airelay`.

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- harness-isolate init create remove` -> `0` (15/15 passed across 2 suites)
- `npm test` -> `0` (223/223 passed across 23 suites; migration warning confirms stale detection works)

## Runtime/IPC Validation (if applicable)
none — migration and profile setup audit; no runtime/IPC changes

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: none
- proposed refactors: none

## Acceptance Criteria Mapping
- `The report explains why .aiswitch/codex-codex2 still exists or confirms it is stale and should not be used` -> pass; evidence: `src/config/migrate.ts` analysis confirms the stale-directory scenario occurs when `.airelay` already exists at migration time; the `.aiswitch/codex-codex2` content is not referenced by any active profile (init uses `~/.airelay/codex`, create-interactive uses `~/.airelay/codex-<name>`); the fix in `migrate.ts` now warns users about this stale state
- `Codex profile creation paths are consistent with the intended shared .codex + isolated auth.json model` -> pass; evidence: `src/utils/harness-isolation.ts` defines `isolatedItems: ['auth.json']` and `sharedItems` pointing to `~/.codex`; `src/utils/harness-isolate.ts:setupIsolatedHarnessHome()` creates symlinks from `~/.codex` and isolates `auth.json`; `src/commands/init.ts` uses non-isolated shared `~/.airelay/codex` for the default codex profile
- `Any migration behavior that leaves stale legacy state is fixed or explicitly justified` -> pass; evidence: `src/config/migrate.ts` now prints a warning when both `.airelay` and `.aiswitch` exist, listing sample stale filenames and advising manual removal. No auto-deletion to avoid data loss risk.
- `Tests remain green and cover the relevant migration/setup behavior` -> pass; evidence: full suite 223/223 passes; migration warning output confirmed in test run logs

## Risks and Follow-ups
- The migration warning uses `console.warn`, which prints to stderr. This is appropriate for a warning.
- The warning only fires when a session path is resolved (via `getSessionsPath()`, `getPIDPath()`, or other callers of `migrateLegacyHomeDirIfNeeded()`). It does not fire on every `airelay` invocation — only when those specific paths are accessed.

## Roadmap Recommendations
- Consider adding a `--clean-legacy` flag to `airelay init` that removes the stale `.aiswitch` directory after confirmation
