---
'@mfeflow/core': minor
---

`add-env-key` rejects schema text that does not parse, lists a `server` key under `globalEnv` in `turbo.json` (Turborepo hides unlisted variables and replays cached builds without running `env.ts`), and core exports `schemaKeys` and `dotenvKeys` for the doctor checks. New error codes E118 to E121.
