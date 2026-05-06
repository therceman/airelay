# Compliance Note

Rewrote `tasks/deepseek_004_post_task_review_prompt_control_report.md` to match `tasks/deepseek_post_task_review_template.md` required structure:

- Replaced `## Validation Commands` with `## Validation` matching template heading
- Moved `## Findings` from nested under `## Required review sections` to top-level section with severity buckets `P0`..`P4`
- Moved `## Executive summary` from nested to top-level section
- Standardized capitalization of all section headings to match template (`## Duplicate-code Findings`, `## Performance-risk Findings`, `## Test/validation Gap Findings`, `## Required Follow-up Tasks`, `## Completion Rule`)
- Each finding retained `severity`, `file path`, `problem`, `impact`, `recommendation`
- Empty severity buckets (`P0`, `P1`) explicitly contain `none`
