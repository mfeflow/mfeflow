---
'mfeflow': minor
---

New commands `mfeflow test`, `mfeflow lint` and `mfeflow typecheck`. Each runs the tool the generated scripts run today (`vitest run`, `oxlint --type-aware --deny-warnings`, `tsc --noEmit`) from the project's own `node_modules/.bin`, never a copy shipped with mfeflow. `--only a,b` picks apps, extra arguments go to the tool after `--`, `typecheck` checks apps side by side with prefixed output (`--jobs`), and `--json` prints one summary with an entry per run. A failed tool exits with 5. A tool that is not installed is the new error E311.
