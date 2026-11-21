---
'mfeflow': minor
---

`mfeflow deploy` no longer uploads `mf-stats.json` or the remote's root `index.html` to the host, and says what it left out (`leftOut` in `--json`, a count by reason in the summary and the dry run, the names with `--verbose`). The generated `@mf-types` are still uploaded, so typed builds keep working; `--no-types` leaves them out. New flag `--no-local-entry` on `deploy`, `promote` and `rollback` skips writing `registry/envs/<env>/<remote>.json`, so CI's working tree stays clean; `status` treats a missing file as "not tracked in the repo" (a note, not drift) and still reports a stale one. The deploy guide now says how the version in the URL is picked.
