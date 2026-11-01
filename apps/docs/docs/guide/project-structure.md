---
title: Project structure
description: A tour of every file in a new mfeflow project, which ones you edit, which ones a feature manages, and what mfeflow.json, mfe.json and the registry folder do.
---

# Project structure

This page is a reference tour of a generated project. Use it to find where things live and which files are yours to change. The tree comes from `pnpm create mfeflow demo --yes` with mfeflow 0.4.0.

## What does the tree look like?

Most of the files sit in the three apps. The root holds the workspace, the registry and the tooling.

```text
demo/
├── mfeflow.json
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── env.ts
├── .env.example
├── .nvmrc  .gitignore  .oxlintrc.json  .prettierrc.json  .prettierignore
├── AGENTS.md  README.md
├── e2e/smoke.spec.ts
├── scripts/check-runtime-config.ts
├── registry/envs/
│   ├── dev/      catalog.json  cart.json
│   ├── staging/  catalog.json  cart.json
│   └── prod/     catalog.json  cart.json
└── apps/
    ├── shell/
    │   ├── mfe.json  package.json  rsbuild.config.ts  tsconfig.json
    │   ├── env.ts  vitest.config.ts
    │   ├── public/config/runtime-config.{dev,staging,prod}.json
    │   └── src/
    │       ├── index.ts  bootstrap.tsx  App.tsx
    │       ├── config/   runtime.ts  schema.ts
    │       ├── pages/    Home.tsx
    │       ├── remotes/  route-table.tsx  catalog.tsx  cart.tsx
    │       ├── api/      endpoints.ts
    │       ├── mocks/    handlers.ts  server.ts
    │       └── test/     setup.ts
    ├── catalog/
    │   ├── mfe.json  package.json  rsbuild.config.ts  tsconfig.json
    │   ├── env.ts  vitest.config.ts
    │   └── src/
    │       ├── index.ts  bootstrap.tsx
    │       ├── exposed/  App.tsx  App.test.tsx
    │       ├── api/  mocks/  test/
    └── cart/   (same layout as catalog)
```

## Which files do I own?

All generated files are yours to edit. mfeflow records a hash of each copied file in `mfeflow.json`. If you change one, `doctor` shows a warning (E117). That is information only. `mfeflow upgrade` uses it to tell your edits from untouched files, and shows you a diff before touching a file you changed.

Some files are also touched by `mfeflow add`. Features look for a fixed shape in them, such as the `routes` array in the route table. Keep that shape when you edit them, or `add` stops and tells you what it could not find (E208).

| File                                     | You edit it                    | A feature or command edits it                  |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `apps/*/src/exposed/App.tsx`             | Yes, this is your remote       | Some features wrap it                          |
| `apps/shell/src/pages/Home.tsx`          | Yes                            | No                                             |
| `apps/shell/src/remotes/route-table.tsx` | Yes                            | `add remote` adds a route                      |
| `apps/shell/src/bootstrap.tsx`           | Rarely                         | Features add boot steps and providers          |
| `apps/*/rsbuild.config.ts`               | Rarely                         | `add remote` writes it; features add an import |
| `mfeflow.json`                           | Only `budget` and `registries` | Every `add` command                            |
| `registry/envs/*/*.json`                 | Yes, before deploy             | `add remote` creates entries                   |
| `apps/*/mfe.json`                        | Yes                            | `add remote` creates it                        |

## What is in the shell?

The shell is the host app. Its entry file is `src/index.ts`. It calls `bootstrap.tsx`, which loads the registry, registers the remotes and renders the app.

`src/remotes/route-table.tsx` maps URL paths to remote components. Each file next to it, such as `catalog.tsx`, renders one remote inside a boundary that shows a fallback when the remote fails. `src/config/` loads the [runtime config](/concepts/runtime-config).

`public/config/runtime-config.<env>.json` holds the values that differ per environment. In the default project each file only has the environment name.

## What is in a remote?

A remote exposes one module, `./App`, from `src/exposed/App.tsx`. Everything outside `src/exposed/` is private to the remote.

Two files exist so you can run the remote alone with `pnpm dev` in its folder: `src/index.ts` and `src/bootstrap.tsx`. Inside the shell only the exposed module is loaded.

The remote's Rsbuild config is a few lines that call a preset:

```ts title="apps/catalog/rsbuild.config.ts"
import { createRemoteConfig } from '@mfeflow/rsbuild';
import './env';

export default createRemoteConfig({
  name: 'catalog',
  port: 4311,
  exposes: { './App': './src/exposed/App.tsx' },
});
```

## What are mfeflow.json and mfe.json?

`mfeflow.json` at the root is the CLI's record of the project: apps, ports, installed features and file hashes. Read the [field reference](/reference/mfeflow-json). Do not edit the hashes by hand.

Each app has an `mfe.json` that names its owner, the routes it claims and what it exposes. See [Ownership](/concepts/ownership) and the [field reference](/reference/mfe-json).

```json title="apps/catalog/mfe.json"
{
  "name": "catalog",
  "owner": "team-catalog",
  "shells": ["shell"],
  "routes": ["/catalog"],
  "exposes": ["./App"]
}
```

## What is in registry/envs?

One JSON file per remote per environment. Each says which build of the remote that environment serves. The dev files point at `localhost` ports. The staging and prod files point at `example.com` until you replace them.

```json title="registry/envs/prod/catalog.json"
{
  "version": "0.0.0",
  "manifestUrl": "https://app.example.com/mfe/catalog/mf-manifest.json",
  "owner": "team-catalog"
}
```

Read [The registry index](/concepts/registry-index) for how these become what the shell reads.

## What do the root files do?

| File                                        | Purpose                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                       | Lists `apps/*` and `packages/*`, and holds the version `catalog` for every dependency        |
| `turbo.json`                                | Defines the `build`, `typecheck` and `dev` tasks for Turborepo                               |
| `package.json`                              | Root scripts: `dev`, `build`, `doctor`, `validate`, `check-compat`, `budget`, `lint`, `test` |
| `env.ts`, `.env.example`                    | Server and build variables, from env-t3                                                      |
| `scripts/check-runtime-config.ts`           | Checks the runtime config files against their schema before a deploy                         |
| `e2e/smoke.spec.ts`, `playwright.config.ts` | A browser test that opens the shell and checks each remote renders                           |
| `.oxlintrc.json`, `.prettierrc.json`        | Lint and format settings from lint-oxlint                                                    |
| `AGENTS.md`                                 | Notes for coding agents working in the repo                                                  |

The versions of React, Rsbuild and the rest sit in the `catalog:` section of `pnpm-workspace.yaml`. Apps refer to them as `catalog:`, so you change a version in one place.

## What changes when I add features?

Features add files and edit existing ones. Adding analytics-gtm to a project adds an `analytics.ts` file to each remote and an `analytics/` folder to the shell. Adding event-bus also creates `packages/contracts/`, a workspace package that holds event types. The [feature catalog](/features/) lists what each one adds.

## Next steps

- See how the pieces load at runtime: [How it works](/guide/how-it-works).
- Add another remote: [Add a remote](/guide/adding-a-remote).
