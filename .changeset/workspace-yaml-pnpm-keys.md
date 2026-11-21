---
'@mfeflow/core': patch
'mfeflow': patch
---

`doctor` no longer warns E117 on `pnpm-workspace.yaml` right after the first install. pnpm adds a `minimumReleaseAgeExclude` list there when it approves freshly published packages; the file hash now leaves that list out, so existing projects keep their recorded hashes.
