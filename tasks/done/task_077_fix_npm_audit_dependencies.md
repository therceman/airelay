# Task 077: Fix npm audit dependency vulnerabilities

## ID
`task_077_fix_npm_audit_dependencies`

## Agent
`DeepSeek`

## Execution Order
`1`

## File Ownership
- `package.json`
- `package-lock.json`
- `tasks/todo/task_077_fix_npm_audit_dependencies_report_draft.md`
- `tasks/todo/task_077_fix_npm_audit_dependencies_report.md`

## Roadmap Ownership
- Do not edit `PLAN.md`.
- Do not edit `PLAN_DONE.md`.
- Recommend roadmap or queue changes in the report only.

## Title
Remediate npm audit vulnerabilities without production-code changes

## Scope
- Start from the clean pushed `master` at `81d34c9` / version `0.1.66`.
- Audit the exact dependency paths for the current high advisories in `brace-expansion` and `js-yaml`.
- Use the smallest safe dependency/lockfile remediation that makes `npm audit` exit `0`.
- Prefer normal compatible dependency updates or a narrowly justified npm `overrides` entry only when the resolved package is compatible with its parent. Do not use `npm audit fix --force` or major upgrades without proving compatibility and documenting the reason.
- Keep production source and tests unchanged unless a dependency API update genuinely requires a minimal compatibility adjustment; report any such exception explicitly.
- Verify the resolved dependency tree no longer contains vulnerable versions, and ensure package-lock is reproducible from a clean install in an isolated temporary copy or equivalent safe procedure.
- Run the authoritative repository checks after remediation.

## Non-goals
- No interrupt, prompt, controller, transcript, or runtime feature work.
- No GPT Tunnel/Gateway/Hub or external repository changes.
- No arbitrary dependency additions, unrelated upgrades, release/tag/publication, or merge operations.
- Do not suppress audit findings or change npm audit configuration to hide them.

## Acceptance criteria
- [ ] `npm audit --json` identifies no remaining vulnerabilities (`total: 0`) and exits `0`.
- [ ] The vulnerable `brace-expansion` and `js-yaml` paths are resolved to advisory-safe versions, with dependency tree evidence in the report.
- [ ] `package.json` and `package-lock.json` remain internally consistent and install reproducibly.
- [ ] No production source or test files are changed unless explicitly justified in the report.
- [ ] `npm run -s build`, `npm run -s lint`, `npm run -s format:check`, and `npm test -- --runInBand` pass.
- [ ] Report is copied from `tasks/report_stub.md`, drafted first, renamed to the exact final report path, and maps every criterion to evidence and command exit codes.
- [ ] After master acceptance, patch version will be bumped `0.1.66 -> 0.1.67`, committed, pushed, and worktree left clean; do not perform that acceptance step before the report is reviewed.

## Validation
- `npm audit --json`
- `npm ls brace-expansion js-yaml --all`
- `npm run -s build`
- `npm run -s lint`
- `npm run -s format:check`
- `npm test -- --runInBand`
- isolated clean-install/reproducibility check appropriate to the package-lock change

## Reporting Contract (Mandatory)
- Start by copying the base stub to a draft file:
  - `cp tasks/report_stub.md tasks/todo/task_077_fix_npm_audit_dependencies_report_draft.md`
- Fill that draft file only; do not author reports from scratch.
- When the report is complete and validated, rename it to the final path:
  - `mv tasks/todo/task_077_fix_npm_audit_dependencies_report_draft.md tasks/todo/task_077_fix_npm_audit_dependencies_report.md`
- The final report file name MUST be exactly `tasks/todo/task_077_fix_npm_audit_dependencies_report.md`.
- `tasks/report_stub.md` is the single source of truth for required report sections and order.
- Every validation command in this task MUST be listed in the report under `## Validation Commands` with exit code.
- Every acceptance criterion MUST be mapped with explicit `pass`/`fail` status and supporting evidence.
- After the final report is renamed, send completion ping to manager:
  - `airelay prompt gpt_master_airelay "task_077_done"`
- If any required report section is missing, renamed, or empty, the task is incomplete.

## Deliverables
- minimal dependency manifest/lockfile remediation
- audit/tree/reproducibility evidence
- report at `tasks/todo/task_077_fix_npm_audit_dependencies_report.md`
