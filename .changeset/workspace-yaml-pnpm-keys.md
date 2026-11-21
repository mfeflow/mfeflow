---
'@mfeflow/core': patch
'mfeflow': patch
---

`doctor` no longer warns E117 on `pnpm-workspace.yaml` right after the first install. pnpm adds a `minimumReleaseAgeExclude` list there when it approves freshly published packages; when mfeflow checks whether you edited that one file, it now leaves that list out, so existing projects keep their recorded hashes. Every other file, and the check in `apply` that a file did not change since the plan, still use the full content.
