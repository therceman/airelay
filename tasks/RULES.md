# Tasks Workflow Rules

## Folder Structure
- `tasks/todo/` — active/open tasks to execute.
- `tasks/rework/` — tasks that failed review or need follow-up changes.
- `tasks/done/` — completed tasks with accepted reports.

## Required Files
- Each task must have:
  - task file: `tasks/<state>/task_<id>_<title>.md`
  - report file: `tasks/<state>/task_<id>_<title>_report.md`
- Do not use `deepseek_` prefixes for new tasks.
- Draft reports must use `_report_draft.md` during execution and be renamed to `_report.md` only when complete.

## Templates
- Normal implementation reports must be created by copying:
  - `tasks/report_stub.md`
- Post-review reports must be created by copying:
  - `tasks/post_review_report_stub.md`
- Workers should not author report structure from scratch.

## Lifecycle
1. Create new task in `tasks/todo/`.
2. Execute task and produce draft report.
3. Validate task (code + tests + report quality).
4. If accepted:
   - move task file and final report to `tasks/done/`.
5. If rejected or incomplete:
   - move task file and report/draft to `tasks/rework/`.
   - create follow-up task in `tasks/todo/`.

## Validation Standard
- Run task-defined validation commands and include command + exit code in report.
- Acceptance criteria must be mapped with explicit evidence.
- Missing/renamed/empty required report sections => task is incomplete.

## Completion Notification
- After report finalization, worker sends:
  - `airelay prompt gpt_master_airelay "<task_id>_done"`

## Master Verification Loop (Mandatory)
- On `<task_id>_done`, master must:
  1. Read task file, report, and changed code.
  2. Run required validation commands locally.
  3. If accepted:
     - move task/report to `tasks/done/` if not already,
     - bump patch version,
     - commit,
     - push.
  4. If rejected/incomplete:
     - create follow-up task in `tasks/todo/` with explicit fixes,
     - send follow-up task to worker,
     - repeat until accepted.

## Commit Policy
- After accepted tasks/follow-ups:
  - bump patch version,
  - commit,
  - push.
- `npm run build` never bumps version by itself.
