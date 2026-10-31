---
'@mfeflow/core': minor
'@mfeflow/contracts': minor
---

Add the feature engine to `@mfeflow/core`: `mfeflow.json` load and save with copied-file hashes, plans as plain data with a summary and unified diff, atomic apply with rollback and an injectable install step, the seven built-in transform ops (`add-import`, `wrap-provider`, `add-shared`, `add-boot-step`, `add-env-key`, `add-route`, `add-workflow-step`), eta and `{{option}}` templates, the `MFEFLOW_Exxx` error catalogue, and a feature loader and resolver for local folders and namespaced registries. Features from a registry are declarative only.

`@mfeflow/contracts` gains the `feature.json` types and validator and validates `files` and `registries` in `mfeflow.json`.
