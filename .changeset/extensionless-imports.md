---
'@mfeflow/oxlint-config': minor
---

Relative imports go without a file extension: `import/extensions` is now an error for `.js`/`.ts` (asset imports such as `.json`, `.css`, `.svg`, `.png` keep theirs), off for `bin/` and `scripts/`, which Node runs directly. Projects already use bundler module resolution, so nothing else changes.
