# Task: Codex Profiles Use Ctrl+J Prompt Submit by Default

## Task ID
`deepseek_030_codex_profile_prompt_submit_ctrl_j_default`

## Context
Current prompt injection behavior is inconsistent with expected Codex terminal UX. For Codex-based profiles, sending `text + Enter` behaves as newline insertion instead of submit in some modes. We need profile-aware default submit semantics.

## Required report flow (mandatory)
1. Copy stub first:
`cp tasks/report_stub.md tasks/deepseek_030_codex_profile_prompt_submit_ctrl_j_default_report_draft.md`
2. Fill draft completely with evidence + validation exits.
3. Rename only when complete:
`mv tasks/deepseek_030_codex_profile_prompt_submit_ctrl_j_default_report_draft.md tasks/deepseek_030_codex_profile_prompt_submit_ctrl_j_default_report.md`

## Scope
- Implement profile-aware default submit behavior in prompt flow:
  - Codex-based profiles: default submit via Ctrl+J semantics.
  - Other profiles: keep current Enter behavior.
- Preserve explicit caller override behavior (`enter:false`, future submit flags if present).
- Add tests covering both profile classes and overrides.

## Primary file ownership
- `src/commands/prompt.ts`
- `src/commands/run.ts` (only if required for protocol compatibility)
- `src/utils/harness.ts` (if needed for harness detection reuse)
- `test/prompt.test.ts`
- `test/controller-e2e.test.ts` (if needed)

## Implementation requirements
1. Determine profile harness for targeted session using saved session profile + config executable mapping.
2. For Codex harness sessions, default `prompt` submit should send Ctrl+J-equivalent semantics (not Enter append).
3. Keep backward compatibility for non-Codex profile sessions.
4. Keep behavior deterministic when explicit options are passed.

## Acceptance criteria
1. Codex session default prompt submit behaves as Ctrl+J semantics.
2. Non-Codex default behavior remains unchanged.
3. Explicit overrides continue to work.
4. Build/lint/tests pass.

## Validation commands (mandatory)
- `npm run -s build`
- `npm run -s lint`
- `npm test -- prompt controller run`
- `npm test`

Record exit codes in report.

## Report requirements
- Final report path:
`tasks/deepseek_030_codex_profile_prompt_submit_ctrl_j_default_report.md`
- Must follow exact heading/order from `tasks/task_report_template.md`.
- Must include `## Acceptance Criteria Mapping` with concrete evidence.

## Constraints
- Do not hardcode profile names (e.g., `codex2`); use harness detection from profile executable.
- Keep changes minimal and localized.
