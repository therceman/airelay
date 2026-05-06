# Task: Remove Hardcoded `codex` and Generalize Profile Logic/Text

## Task ID
`deepseek_028_remove_hardcoded_codex_and_generalize_profile_text`

## Context
Current codebase still contains many hardcoded `codex` references in CLI text, command behavior, and guidance where behavior should be profile-driven/harness-aware. This causes product language drift and special-case logic leakage.

The target state is:
- `codex` naming is only used where technically required for Codex profile/config handling.
- User-facing command text/help/messages are profile-agnostic by default.
- Harness-specific behavior must be resolved via existing harness utilities/config, not hardcoded wording.

## Required report flow (mandatory)
1. Create report draft first by copying the stub:
   `cp tasks/report_stub.md tasks/deepseek_028_remove_hardcoded_codex_and_generalize_profile_text_report_draft.md`
2. Fill the draft completely with evidence.
3. Rename only when complete:
   `mv tasks/deepseek_028_remove_hardcoded_codex_and_generalize_profile_text_report_draft.md tasks/deepseek_028_remove_hardcoded_codex_and_generalize_profile_text_report.md`

## Scope
- Audit and remove hardcoded `codex` from user-facing text and generic command flows.
- Keep `codex` references only in Codex profile/config implementation paths (example: env var keys, isolation config entries, codex-specific profile adapter files).
- Replace hardcoded messaging with harness/profile-aware wording.
- Preserve all existing behavior for opencode and codex profiles.

## File ownership (primary)
- `src/cli.ts`
- `src/commands/create-interactive.ts`
- `src/commands/isolate.ts`
- `src/commands/remove.ts`
- `README.md`
- related tests touching help text or command output

## Implementation requirements
1. User-facing text and help
- Remove global/product-level hardcoded `codex` wording where it implies codex-only behavior.
- Use neutral terms such as `profile`, `harness`, `overlay profile`, `shared-base profile`.
- Keep Codex naming only where the behavior is truly Codex-specific.

2. Command behavior
- Ensure `isolate`/`remove` command messaging and guardrails are harness-aware and not codex-branded unless truly codex-only by design.
- If command remains codex-specific functionally, explicitly surface that in a minimal technical message, not global branding text.

3. README/docs
- Remove codex hardcoding from high-level description.
- Keep codex details inside dedicated codex-specific sections/examples.

4. Tests
- Update/add tests for help/output strings and command behavior affected by this refactor.
- Ensure no regressions in existing command tests.

## Acceptance criteria
- `rg -n "hardcoded codex|Codex profile overlay|codex-only" src README.md` returns no stale hardcoded product-language fragments introduced by prior tasks.
- High-level CLI/README copy is profile-agnostic.
- Codex-specific references remain only where technically required.
- Build/lint/tests all pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- cli create isolate remove`
- `npm test`

Record exit codes in the report.

## Report requirements
- Final report path:
  `tasks/deepseek_028_remove_hardcoded_codex_and_generalize_profile_text_report.md`
- Must follow exact headings/order from `tasks/task_report_template.md`.
- Must include explicit acceptance-criteria mapping with concrete file evidence.

## Constraints
- Do not change unrelated runtime/session logic.
- Do not remove Codex-specific internals that are required for real behavior.
- Prefer minimal, surgical edits.
