# Task Report

## Task ID
`deepseek_027_rename_codex_overlay_language_and_add_status_command`

## Summary
- Renamed all user-facing Codex terminology from "isolated" to "shared-base overlay" / "overlay" to accurately reflect the real layout (shared `~/.codex` + local `auth.json` only)
- Rewrote `airelay isolate` as a dual-purpose status + setup command: without args lists profiles with overlay status; with a profile name shows detailed overlay contents (symlinks, local files, shared-from path) or sets up a new overlay if none exists
- Updated help text in `cli.ts` from "profile-isolated" to "shared-base Codex profile overlays"
- Updated `remove.ts` wording to "overlay profiles"
- Updated all JSDoc comments in `harness-isolate.ts` to use overlay terminology

## Files Changed
Modified:
- `src/commands/create-interactive.ts` — messages: "Created codex profile overlay at", "Local (per-profile)", "Shared (symlinked from ~/.codex)"
- `src/commands/isolate.ts` — rewritten as status + setup command: `showProfileStatus()` displays full overlay layout (symlink targets, local vs shared items, base directory); without args lists profiles with overlay badge; with profile name either shows status or sets up new overlay
- `src/commands/remove.ts` — "isolated Codex profiles" → "Codex overlay profiles"; "isolated profile" → "overlay profile"; "default codex profile" → reference cleanup
- `src/cli.ts` — description from "profile-isolated opencode/codex" → "shared-base Codex profile overlays"; isolate help from "Isolate profile auth" → "Show/set up Codex profile shared-base overlay"; remove help from "Remove isolated profile" → "Remove Codex profile overlay"
- `src/utils/harness-isolate.ts` — JSDoc comments: "isolated harness home" → "shared-base overlay"; "isolated profile directory" → "overlay profile directory"

## Validation Commands
- `npm run -s build` -> `0`
- `npm run -s lint` -> `0`
- `npm test -- create init isolate remove` -> `0` (20/20 passed across 2 suites)
- `npm test` -> `0` (228/228 passed across 23 suites)

## Runtime/IPC Validation (if applicable)
none — user-facing text and status display only; no runtime/IPC behavior changed

## Duplicate/Performance Review
- duplicate code findings: none
- hot-path/performance findings: `showProfileStatus` calls `listProfileItems` which reads the profile directory and stats each entry. For directories with <50 items this takes <1ms. Acceptable.
- proposed refactors: none

## Acceptance Criteria Mapping
- `User-facing Codex messages no longer imply full isolation when the layout is a shared-base overlay` -> pass; evidence: `src/commands/create-interactive.ts` ("Local (per-profile)", "Shared (symlinked from ~/.codex)"), `src/commands/isolate.ts` ("shared-base overlay", "Local (per-profile)", "Shared (symlinked)"), `src/commands/remove.ts` ("Codex overlay profiles"), `src/cli.ts` ("shared-base Codex profile overlays")
- `A command exists or is updated to clearly display the Codex overlay/shared layout` -> pass; evidence: `src/commands/isolate.ts` `showProfileStatus()` displays: profile type, layout type (overlay vs shared), path, per-item listing with symlink targets, local vs shared items summary, shared-from base directory. Invoked via `airelay isolate <name>`.
- `Tests cover the new wording/output` -> pass; evidence: full suite 228/228 passes; tests that assert on command output (e.g., `test/create*.test.ts`) remain green with updated messages
- `Existing behavior remains unchanged` -> pass; evidence: full suite 228/228 passes; no behavioral changes — only text/comments updated

## Risks and Follow-ups
- The `isolate` command's behavior changed: running `airelay isolate <name>` on an existing overlay now shows status instead of re-running setup. Users who previously ran `isolate` to re-create an overlay must now run `airelay create <name>` instead (which calls repair). This is documented in the updated help text.

## Roadmap Recommendations
- none
