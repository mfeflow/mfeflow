---
'mfeflow': minor
'@mfeflow/core': minor
---

`mfeflow check-compat` can now check against a shell that lives in another repository. Pass `--against` a registry index, a deployed shell `mf-manifest.json`, or a file of either, and every remote in the repo is checked against the versions that shell shares. Before, a polyrepo project passed this check without anything being compared. Now it warns and tells you to pass `--against`. A source that cannot be read is the new error E307.
