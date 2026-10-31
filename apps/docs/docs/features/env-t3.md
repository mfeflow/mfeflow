# env-t3

Typed environment variables with [t3-env](https://env.t3.gg), without baking an environment into a bundle.
On by default in new projects.

```sh
mfeflow add env-t3                                   # zod
mfeflow add env-t3 --option env-t3.validator=valibot # or arktype
mfeflow init my-app --option env-t3.validator=arktype --yes
```

## What you get

| File                                                 | What it is for                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts` in every app and in the project root        | `createEnv({ server, runtimeEnv: process.env, emptyStringAsUndefined: true })`. `rsbuild.config.ts` imports it, so a missing or invalid server variable fails the build and names the variable. The root one is for scripts (deploy, CI). |
| `.env.example` next to each `env.ts`                 | The variables a new developer has to set.                                                                                                                                                                                                 |
| `apps/shell/src/config/schema.ts`                    | The runtime-config schema, a Standard Schema object (`runtimeConfigSchema`).                                                                                                                                                              |
| `apps/shell/public/config/runtime-config.<env>.json` | One file per environment: `dev`, `staging`, `prod`.                                                                                                                                                                                       |
| `apps/shell/src/config/runtime.ts`                   | `getRuntimeConfig()`, typed from the schema, and the boot step that loads `/config/runtime-config.json`.                                                                                                                                  |
| `scripts/check-runtime-config.ts`                    | `pnpm check:runtime-config [env ...]` validates every config file against the schema. Run it in CI and before a deploy.                                                                                                                   |

## Server variables and runtime config

Build once, deploy many: one build runs in dev, staging and prod, so nothing that differs per environment is
compiled into it.

- **Server and build-time variables** (`env.ts`) are read by processes: `rsbuild`, scripts, the registry. They are
  never in the browser bundle. The build is the only place their values are used.
- **Browser configuration** (API base URLs, a GTM container, flags) lives in `runtime-config.<env>.json`, served as
  `/config/runtime-config.json` by the environment. The shell fetches it once at boot, and `getRuntimeConfig()` returns
  it with the types of the schema. The browser bundle imports only the _type_ of the schema, so the validator
  (zod, valibot or arktype) is not in it; `pnpm check:runtime-config` validates the files at deploy time.

`public/config/` is copied into `dist/`, so every environment's file ships in every build. Keep secrets out of
runtime config; it is public by design.

### Which file `/config/runtime-config.json` is

There is no `runtime-config.json` in the project; each environment picks its own file.

- **`pnpm dev` and `rsbuild preview`**: the dev and preview servers answer `/config/runtime-config.json` with
  `runtime-config.dev.json`. Set `MFE_ENV` to use another environment's file, for example
  `MFE_ENV=staging pnpm exec rsbuild preview` in `apps/shell`. A name with no file is a 404 that lists the files that exist, and the smoke test
  fails on it.
- **A deploy**: the build is the same for every environment. As the last step of a deploy, copy that environment's file
  over the URL the shell fetches:

  ```sh
  pnpm check:runtime-config prod
  cp dist/config/runtime-config.prod.json dist/config/runtime-config.json
  ```

  Or have the host or CDN rewrite `/config/runtime-config.json` to `/config/runtime-config.prod.json`. A deploy that
  skips the step makes the shell report a failed load and `getRuntimeConfig()` throw, rather than run with another
  environment's values.

## Add a key

```sh
mfeflow add env-key API_ORIGIN --scope server --schema "z.url()" --value https://api.example.com
mfeflow add env-key GTM_ID --scope runtime --schema "z.string().min(1)" --value GTM-XXXX
```

The schema is written in the validator you chose: `v.pipe(v.string(), v.url())` for valibot, `type('string.url')`
for arktype.

- `--scope server` adds the key to `env.ts` in every app (`--app cart` for one, `--app root` for the root), a line to
  `.env.example`, and the key to `globalEnv` in `turbo.json`. Turborepo hides variables it was not told about and
  replays cached builds without running `env.ts`, so an unlisted key would not reach the build.
- `--scope runtime` adds the key to the schema and to every `runtime-config*.json` of the shell. Fill in the real
  value per environment; `pnpm check:runtime-config` fails until each file passes the schema.
- Running it again changes nothing. `--dry-run` prints the diff.

## `PUBLIC_*` variables

Rsbuild inlines every `PUBLIC_*` variable at build time. Use them only for values that are the same everywhere
(`PUBLIC_APP_NAME`, `PUBLIC_BUILD_VERSION`). Anything else belongs in runtime config; `mfeflow doctor` warns (E120).

## Doctor checks

With the feature installed, `mfeflow doctor` also runs:

| Check                | Code                 | Finds                                                                                        |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `env.example`        | [E118](/errors/E118) | a required key missing from `.env.example`, or a key there that `env.ts` lacks               |
| `env.runtime-config` | [E119](/errors/E119) | a runtime-config file missing a required key, not valid JSON, or with a key the schema lacks |
| `env.public-prefix`  | [E120](/errors/E120) | a `PUBLIC_*` variable other than the two constants                                           |
| `env.turbo`          | [E121](/errors/E121) | a required server key not listed in `turbo.json`                                             |

Doctor compares keys without running your code; the values are checked by `pnpm check:runtime-config`.

## Notes

- `scripts/check-runtime-config.ts` runs with `node --experimental-strip-types`, so it needs Node 22.12 or newer
  (22.18 or newer without a warning).
- Runtime config belongs to the shell. Remotes call nothing at boot; a remote that needs a value gets it from the
  shell's config or from its own build.
- `@t3-oss/env-core` is a 0.x package. It is pinned in the catalog and used only in `env.ts`, so replacing it is a
  change to those files.
