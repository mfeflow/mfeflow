---
'@mfeflow/contracts': minor
---

`COST_MODEL`, `judgeCost` and `splitScripts`: the cost-model budget (LCP at most +300 ms, the shell at most +32 KB of JS over the same pages built as one app, each remote on a route at most +10 KB) as code, shared by `mfeflow budget` and the CI perf job. `mfeflow.json` accepts an optional `budget` (`shellKb`, `remoteKb`, `lcpDeltaMs`, `baselineKb`).
