---
title: env-t3 - Typed env that fails the build, config you can swap per environment
description: Validate server variables when the build starts, and load browser settings from a per-environment JSON file so one build runs in dev, staging and prod.
---

# env-t3

This feature stops a missing variable from reaching production, and keeps environment-specific values out of your JavaScript bundle. Server and build variables are checked when the build starts. Browser settings come from a small JSON file that each environment supplies.

## What you get

Build-time variables go in `env.ts`, checked with [t3-env](https://env.t3.gg). Anything the browser needs, like an API URL or a GTM id, goes in runtime config, a JSON file the shell fetches when it boots. That split is what lets you build once and deploy the same files to every environment. New projects get this feature by default.

## Add it

```sh
pnpm mfeflow add env-t3
```

To pick a different validator than zod:

```sh
pnpm mfeflow add env-t3 --option env-t3.validator=valibot
```

What changed:

- `env.ts` and `.env.example` in the project root, the shell and every remote
- `apps/shell/src/config/schema.ts`, the runtime config schema
- `apps/shell/src/config/runtime.ts`, which loads the config at boot
- `apps/shell/public/config/runtime-config.dev.json`, `.staging.json` and `.prod.json`
- `scripts/check-runtime-config.ts`, wired up as `pnpm check:runtime-config`
- an import of `./env` in each `rsbuild.config.ts`, and `loadRuntimeConfig` as a boot step in the shell

## Use it

### Add a secret the server needs

```sh
pnpm mfeflow add env-key API_ORIGIN \
  --scope server --schema "z.url()" --value https://api.example.com
```

The key lands in `env.ts` for every app, in each `.env.example`, and under `globalEnv` in `turbo.json`. Write the schema in your validator's syntax: `v.pipe(v.string(), v.url())` for valibot, `type('string.url')` for arktype. Pass `--app cart` for one app, or `--app root` for the root. Run it twice and nothing changes, and `--dry-run` prints the diff.

This is the generated file before you add anything:

```ts title="apps/shell/env.ts"
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

Because `rsbuild.config.ts` imports it, a missing or invalid variable stops the build and names the variable.

### Add a setting the browser needs

```sh
pnpm mfeflow add env-key GTM_ID \
  --scope runtime --schema "z.string().min(1)" --value GTM-XXXX
```

This adds the key to the schema and to all three `runtime-config.<env>.json` files. Put the real value in each environment's file, because `pnpm check:runtime-config` fails until every file passes the schema.

Read it in code with the type your schema gives it:

```ts
import { getRuntimeConfig } from './config/runtime';

const { environment } = getRuntimeConfig();
```

### Serve and ship the right file

There is no file named `runtime-config.json` in your project. `pnpm dev` and `rsbuild preview` answer `/config/runtime-config.json` with the dev file, and `MFE_ENV` picks another one:

```sh
MFE_ENV=staging pnpm exec rsbuild preview
```

For a deploy, validate the environment's file and copy it over the URL the shell fetches, as the last step:

```sh
pnpm check:runtime-config prod
cp dist/config/runtime-config.prod.json dist/config/runtime-config.json
```

A host or CDN rewrite from `/config/runtime-config.json` to the prod file does the same job. If you skip this step the shell reports a failed load and `getRuntimeConfig()` throws, so it never runs with another environment's values.

## Configure it

| Option                           | Values                         | Default | Where it applies                                  |
| -------------------------------- | ------------------------------ | ------- | ------------------------------------------------- |
| `env-t3.validator`               | `zod`, `valibot`, `arktype`    | `zod`   | `env.ts`, the runtime config schema and the check |
| `MFE_ENV` (environment variable) | an environment name, lowercase | `dev`   | which file the dev and preview servers serve      |

The validator prompt is the only option in `feature.json`. Dependencies are pinned there too: `@t3-oss/env-core` 0.13.11, plus zod 4.6.7, valibot 1.5.0 or arktype 2.2.9.

## How it works

`env.ts` runs in whatever process imports it, such as rsbuild or a script, and never ships to the browser. The browser bundle imports only the type of `runtimeConfigSchema`, so the validator library stays out of it. At boot, `loadRuntimeConfig()` calls `fetchRuntimeConfig()` from `@mfeflow/runtime`, which fetches the file once however many features read it.

Features that need browser settings add their own keys the same way you do: [analytics-gtm](/features/analytics-gtm) adds `gtmId`, [telemetry-otel](/features/telemetry-otel) adds `otlpEndpoint`, `traceSampleRatio` and `propagateTraceHeaderCorsUrls`, and [analytics-clarity](/features/analytics-clarity) adds `clarityId`. The order you add the features in does not matter.

`pnpm mfeflow doctor` also checks the setup:

| Check                | Code                 | Finds                                                                                        |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `env.example`        | [E118](/errors/E118) | a required key missing from `.env.example`, or a key there that `env.ts` lacks               |
| `env.runtime-config` | [E119](/errors/E119) | a runtime-config file missing a required key, not valid JSON, or with a key the schema lacks |
| `env.public-prefix`  | [E120](/errors/E120) | a `PUBLIC_*` variable other than the two constants                                           |
| `env.turbo`          | [E121](/errors/E121) | a required server key not listed in `turbo.json`                                             |

Doctor compares keys without running your code. The values are checked by `pnpm check:runtime-config`.

## Gotchas

:::warning
Runtime config is public. Everything in `public/config/` is copied into `dist/`, so every environment's file ships with every build. Keep secrets in `env.ts`, never in a runtime-config file.
:::

- **`PUBLIC_*` variables are baked in.** Rsbuild inlines them at build time, so use them only for values that are the same everywhere (`PUBLIC_APP_NAME`, `PUBLIC_BUILD_VERSION`). Doctor warns about anything else with E120.
- **An old `runtime-config.json`.** If a feature created `public/config/runtime-config.json` before you added env-t3, delete it. The per-environment files replace it, and doctor reports it as missing `environment` until it is gone.
- **Only the shell has runtime config.** Remotes call nothing at boot. A remote that needs a value reads it from the shell's config or gets it from its own build.
- **Node version.** The check script runs with `node --experimental-strip-types`, so it needs Node 22.12 or newer.
- **t3-env is 0.x.** It is used only in `env.ts`, so replacing it later means changing those files and nothing else.

## Reference

- [Runtime config](/concepts/runtime-config), the idea behind build once, deploy many
- [Deploying](/guide/deploying) and [CI and budgets](/guide/ci-and-budgets) for where the check runs
- [E118](/errors/E118), [E119](/errors/E119), [E120](/errors/E120) and [E121](/errors/E121)
- [`mfeflow` CLI reference](/reference/cli)
- [t3-env documentation](https://env.t3.gg)
