---
'mfeflow': patch
'@mfeflow/contracts': patch
'@mfeflow/core': patch
'create-mfeflow': patch
'@mfeflow/i18n': patch
'@mfeflow/oxlint-config': patch
'@mfeflow/rsbuild': patch
'@mfeflow/runtime': patch
'@mfeflow/storage': patch
'@mfeflow/testing': patch
'@mfeflow/theme': patch
'@mfeflow/tsconfig': patch
'@mfeflow/url-factory': patch
---

Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.
