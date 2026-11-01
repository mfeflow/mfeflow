---
'mfeflow': patch
'@mfeflow/core': patch
---

`mfeflow upgrade` now refuses to write a file that sits under a symlinked folder, not only a file that is itself a symlink. `--accept-changed-content` can name the registry features to take (`--accept-changed-content @acme/hello`); on its own it still takes all of them, and the new hash is saved even when no file changes. A registry feature with no recorded hash is shown as first seen, in the plan and in `--json`. An env file you never edited takes the new template when only a value changed upstream, and the message says whether keys or values would be lost. Dependencies from a registry feature are marked as such in an upgrade plan.
