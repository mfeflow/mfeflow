---
'@mfeflow/core': minor
---

Harden the feature engine. Third-party features now pass allowlists instead of denylists: write locations (`src/`, `public/`, `docs/`), script names, dependency ranges (semver or dist-tag), module specifiers and `add-env-key` schema text, and cannot edit CI. Path checks fold case and Unicode, apply refuses targets that resolve outside the project through symlinks, rollback no longer writes through links and restores the lockfiles and `package.json` an install changed, `mfeflow.json` edits made after planning are an E211, and an existing script or dependency range is never overwritten. The transforms handle `#!` files, one-line bodies and closers on the last item's line, refuse `await` in a non-async function, and edit workflow YAML in place. Registry answers are size-capped on streamed bytes.
