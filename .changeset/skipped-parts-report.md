---
'mfeflow': minor
'@mfeflow/core': minor
---

In a repo that has remotes and no shell, a feature's shell parts were dropped without a word. The plan now lists them: `plan.skipped` in `--json` (`feature`, `kind` of part, `name`, `target`; the key is new, the others are unchanged) and one line per feature in the text output, "Skipped because this repo has no shell: ... Add `<feature>` in the shell repo too." What is written does not change. Nothing is listed for a project with a shell, for a repo with no apps, or for parts that target the remotes or the root. `@mfeflow/core` adds `Plan.skipped`, `PlanBuilder.skip` and `skippedLines`.
