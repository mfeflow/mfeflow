---
'mfeflow': minor
---

`mfeflow add env-key <KEY> --scope server|runtime --schema <expr>` adds a typed env key to `env.ts` or the runtime-config schema, `.env.example` or every runtime-config file, and `turbo.json`. `mfeflow doctor` checks `.env.example`, the runtime-config files, `PUBLIC_*` use and `turbo.json` against the schema once `env-t3` is installed (E118 to E121). The `mfeflow` package is linked by `--local` like the `@mfeflow/*` ones.
