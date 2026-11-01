---
'@mfeflow/rsbuild': minor
---

Add `registerHeadScript(name, source)`: `createShellConfig` puts each registered script first in the shell's `<head>`, ahead of the bundles. A name registered again replaces its script, so a dev-server config reload does not add a second one. The `theming` feature uses it for the stored-theme script.
