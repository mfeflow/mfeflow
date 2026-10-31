---
'@mfeflow/oxlint-config': minor
---

New lint error: relative imports of code (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`) must not carry a file extension (`import/extensions`). Asset imports (images, fonts, styles, JSON) keep theirs, package imports are not checked, and the rule is off under `bin/` and `scripts/`, which Node runs directly. This needs bundler module resolution (`@mfeflow/tsconfig` presets already use it). If a project runs other TypeScript files directly with Node (type stripping needs the extension), turn the rule off for them with an `overrides` entry.
