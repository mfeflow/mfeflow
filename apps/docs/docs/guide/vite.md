---
title: Build with Vite
description: Create an mfeflow project that builds with Vite and @module-federation/vite instead of Rsbuild, move an existing project over with upgrade --bundler, and what differs between the two.
---

# Build with Vite

mfeflow builds with Rsbuild by default. It can build with [Vite](https://vite.dev) and [`@module-federation/vite`](https://github.com/module-federation/vite) instead. Everything else stays the same: the registry, `mfeflow dev`, the checks, the budgets, deploys and every feature.

One project uses one bundler. The choice is the `bundler` field of `mfeflow.json`.

## Create a Vite project

Pass `--bundler vite` to `init`:

```bash
pnpm create mfeflow my-platform --bundler vite
cd my-platform
pnpm mfeflow dev
```

You should see each app start Vite, and the shell at http://localhost:4300:

```text
mfeflow: running shell, catalog, cart. Ctrl+C stops everything.
shell   | $ vite
catalog | $ vite
cart    | $ vite
shell   |   VITE v8.3.5  ready in 264 ms
shell   |   ➜  Local:   http://localhost:4300/
```

A preset can set it too: `{ "bundler": "vite" }`.

## What a Vite app has

Each app has a `vite.config.ts` and an `index.html` in place of `rsbuild.config.ts`:

```ts
// apps/cart/vite.config.ts
import { createRemoteConfig } from '@mfeflow/vite';

export default createRemoteConfig({
  name: 'cart',
  port: 4312,
  exposes: { './App': './src/exposed/App.tsx' },
});
```

`@mfeflow/vite` takes the same options as `@mfeflow/rsbuild`, except `esmRuntime` (Vite already uses the ESM runtime) and `consumesRemotes` (accepted, no effect), and both share their settings through `@mfeflow/bundler-shared`. So a Vite app shares the same singletons, writes the same `mf-manifest.json` and loads the same runtime plugins.

| Rsbuild                             | Vite                                       |
| ----------------------------------- | ------------------------------------------ |
| `rsbuild.config.ts`                 | `vite.config.ts` and `index.html`          |
| `@mfeflow/rsbuild`, `@rsbuild/core` | `@mfeflow/vite`, `vite`                    |
| `rsbuild dev`, `rsbuild build`      | `vite`, `vite build`                       |
| `html.tags`, `registerHeadScript`   | `registerHeadScript` from `@mfeflow/vite`  |
| `dev.watchFiles` restart            | `pluginRestartOn(path)`                    |
| `PUBLIC_*` in the browser           | `PUBLIC_*` only, through `import.meta.env` |
| hashed files under `/static/`       | hashed files under `/assets/`              |
| `storybook-react-rsbuild`           | `@storybook/react-vite`                    |

The features write the right files for the bundler: `theming` registers its head script with `@mfeflow/vite`, `env-t3` imports `./env` from `vite.config.ts`, `storybook` uses `@storybook/react-vite`, and `deploy-docker` and `deploy-cloudflare` cache `/assets/` for a year.

## Move an existing project

`upgrade --bundler vite` moves a project from Rsbuild to Vite. Try it with `--dry-run` first:

```bash
pnpm mfeflow upgrade --bundler vite --dry-run
pnpm mfeflow upgrade --bundler vite
```

It writes `vite.config.ts` and `index.html` for each app and replays every installed feature for Vite. It also removes what only Rsbuild needed: each config file you did not change, `@mfeflow/rsbuild` and `@rsbuild/core`, and the `dev` and `build` scripts if they are still the generated ones. A config file you changed is left where it is, with a warning, so you can port your changes to `vite.config.ts` and delete it. `--bundler rsbuild` goes back.

The move runs together with an upgrade to the version of mfeflow you run.

## Limitations

- The bundler is per project. `mfeflow adopt` takes in a folder whose apps all build with Vite as a Vite project, and keeps a mix on Rsbuild with a warning.
- `@module-federation/vite` turns itself off under Vitest. That keeps unit tests fast and is why tests never load remotes.
- Vite's own warning about `import "./env"` without an extension is harmless. It comes from Vite's future config loader.
- A shell from one bundler can load a remote from the other. Share `react/jsx-runtime` and `react/jsx-dev-runtime` as their own keys on both sides, as the presets do, or the JSX of the remote fails to run.
