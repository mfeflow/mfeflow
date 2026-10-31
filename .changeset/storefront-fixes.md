---
'@mfeflow/rsbuild': patch
'@mfeflow/runtime': patch
'@mfeflow/storage': patch
'@mfeflow/theme': patch
'@mfeflow/i18n': patch
'@mfeflow/testing': patch
'@mfeflow/url-factory': patch
'@mfeflow/contracts': patch
---

Fixes found by the storefront example: React packages now build with the automatic JSX runtime (no `React is not defined`); every package's `exports` has a `default` condition so `require.resolve` finds it and Module Federation shares it; `@mfeflow/rsbuild` pins each shared package's `requiredVersion` to the installed version instead of a `catalog:` or `workspace:*` spec.
