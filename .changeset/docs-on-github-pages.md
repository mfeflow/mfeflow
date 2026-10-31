---
'mfeflow': patch
'create-mfeflow': patch
'@mfeflow/core': patch
'@mfeflow/contracts': patch
'@mfeflow/rsbuild': patch
'@mfeflow/runtime': patch
'@mfeflow/url-factory': patch
'@mfeflow/theme': patch
'@mfeflow/i18n': patch
'@mfeflow/storage': patch
'@mfeflow/testing': patch
'@mfeflow/tsconfig': patch
'@mfeflow/oxlint-config': patch
---

The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.
