# Storefront

The example app inside the mfeflow repo. A shell with two remotes, plus the same app built as one bundle. The end-to-end tests, the benchmarks and the perf job run against it, so it is also the proof for the numbers in the root README.

It is part of the repo's pnpm workspace, so there is nothing to install here beyond the root `pnpm install`. To start a project of your own, use `npm create mfeflow@latest` instead.

## What is in it

```text
storefront/
  shell/       the shell, port 4300 (createShellConfig)
  catalog/     remote, port 4311, exposes ./App and ./stock
  cart/        remote, port 4312, exposes ./App and ./MiniCart
  contracts/   @storefront/contracts: the typed events and routes the apps share
  monolith/    the same pages as one bundle, port 4302, the baseline the remotes are measured against
  e2e/         Playwright tests, a static server for the build, and the Lighthouse perf run
```

All apps build with Rsbuild and `@mfeflow/rsbuild`.

## Run it

From the repo root:

```sh
pnpm install
pnpm build
```

Each app has `dev`, `build` and `typecheck` scripts, run through pnpm filters:

```sh
pnpm --filter @storefront/shell dev
pnpm --filter @storefront/catalog dev
pnpm --filter @storefront/cart dev
```

The tests build the shell in development mode, serve the built shell and remotes like production (`e2e/serve.ts`), and run Playwright:

```sh
pnpm e2e
```

`pnpm --filter @storefront/e2e perf` runs the Lighthouse measurement.
