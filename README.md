# mfeflow

**The React micro-frontend boilerplate that keeps going after day one.**

`create-module-federation` gives you a host and a remote. mfeflow gives you
the platform around them: pick features à la carte, self-host a registry with
one-command rollback, and keep many teams on one React, one tag manager and
one tracer.

[![ci](https://github.com/mfeflow/mfeflow/actions/workflows/ci.yml/badge.svg)](https://github.com/mfeflow/mfeflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mfeflow)](https://www.npmjs.com/package/mfeflow)
[![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=mfeflow_mfeflow&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mfeflow_mfeflow)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mfeflow_mfeflow&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mfeflow_mfeflow)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mfeflow/mfeflow/badge)](https://scorecard.dev/viewer/?uri=github.com/mfeflow/mfeflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **Early, built in the open.** Nothing is released yet. The first release (0.1.0 of
> every package) is being prepared.

## Status

0.3.0 is on npm; every public package is versioned together (see [versioning and releases](docs/versioning.md) for the version policy and the release flow). Phase 04 (features) is built, with three things still open: there is no `mfeflow remove`, so "adds and removes cleanly" is tested for adding only; the dev overlay is not built; and the generated GitHub Actions workflow has not yet been run on a fresh GitHub repository.

What works today, from the repo:

- `@mfeflow/contracts`: types and validators for `mfe.json`, `mfeflow.json`, `feature.json` and the registry, and the cost model.
- `@mfeflow/runtime`, `@mfeflow/rsbuild`, `@mfeflow/storage`, `@mfeflow/theme`, `@mfeflow/i18n`, `@mfeflow/url-factory`: the runtime and build packages, exercised by the storefront example.
- `@mfeflow/tsconfig`, `@mfeflow/oxlint-config`, `@mfeflow/testing`: shared config and test helpers.
- `@mfeflow/analytics` and `@mfeflow/telemetry`: singleton packages behind provider interfaces, started by the shell only. Google Tag Manager with Consent Mode v2, and OpenTelemetry for the browser loaded after first render. The `analytics-gtm` and `telemetry-otel` features wire them into a project.
- `@mfeflow/event-bus`, `@mfeflow/route-factory` and `@mfeflow/http`: typed events between remotes (a shared singleton, with replay for late subscribers), typed links between remotes from a contracts package, and a fetch client over the url-factory endpoints with retries for idempotent requests. The `event-bus`, `route-factory` and `http` features wire them into a project.
- The react-scale features, built on `@mfeflow/theme`, `@mfeflow/i18n` and `@mfeflow/analytics`: `theming`, `i18n`, `tailwind` (reset in the shell, a class prefix per app), `ui-shadcn`, `forms`, `data-react-query`, `storybook` (composed in the shell), `analytics-clarity` (after consent) and `commit-prompt`. See the feature pages in the docs.
- `@mfeflow/core`: the engine behind the CLI. It loads and saves `mfeflow.json`, plans a change as data with a unified diff, applies it atomically with rollback, edits files with seven built-in transform ops, and resolves features from a local folder or a namespaced registry. Third-party features are declarative only and never run code.
- Third-party registries: `mfeflow registry add @ns <url>` adds one, `mfeflow features` searches it next to the first-party features, `mfeflow add @ns/name` installs from it, and `mfeflow registry build <dir>` checks and writes a registry to host on any static host (GitHub Pages works). The [`e2e/registry-fixture`](e2e/registry-fixture/README.md) registry is served from `127.0.0.1` in the tests and in the matrix. See [Third-party features](apps/docs/docs/features/third-party.md).
- `mfeflow` and `create-mfeflow`: `init`, `add remote|shell|<feature>`, `features` and `registry`; the first features (`tsconfig`, `lint-oxlint`, `url-factory`, `git-hooks`); `--local` to run a generated project from a checkout.
- `mfeflow dev` (one command for the shell and every remote, a dev registry that follows `add remote`, `--remote name=url` overrides), `mfeflow doctor` (with `--fix` and `--json`), `validate`, `check-compat` and `budget` for CI.

Checked in CI: unit tests with coverage, the storefront e2e, a smoke job that generates a project and runs `mfeflow dev`, the
[feature matrix](.github/workflows/matrix.yml) (every combination of the first-party features, on every pull request that
touches the CLI, the engine, the features or the templates; nightly on macOS and Windows too, pnpm only) and the
[cost-model perf job](.github/workflows/perf.yml) (LCP at most +300 ms, the shell at most +32 KB of JS and each remote on a
route at most +10 KB, against the same pages built as one app).

Time to a running platform, measured by [`bench/`](bench/README.md) on 2026-10-31 (warm pnpm store, median of 5, arm64 laptop with 8 cores):
about 5 s from `create-mfeflow` to a shell and two remotes answering on `pnpm dev`.

Next: `upgrade`, the typed env feature, the registry and the generated CI/CD.

## What it will do

```bash
npm create mfeflow@latest my-platform     # pick topology, remotes and features
mfeflow add telemetry-otel analytics-gtm  # add what you need later
mfeflow add event-bus route-factory http
mfeflow add theming i18n tailwind     # shell-owned theme and language, Tailwind with a prefix per remote
mfeflow deploy catalog --env prod
mfeflow rollback catalog --env prod       # a pointer flip, no rebuild
```

- **Module Federation 2.0 on Rsbuild**, with React and other stateful
  libraries shared as singletons and checked at build and run time.
- **Features à la carte**: typed API URLs, Google Tag Manager with Consent
  Mode v2, OpenTelemetry, typed cross-app events, ESLint and tsconfig
  presets, tests and CI. Code you own is copied into your project; logic that
  needs fixes is installed and upgraded with migrations.
- **A self-hosted registry**: versioned remotes on any static host, or a small
  server with percentage rollouts and a kill switch. Promote and roll back
  without rebuilding.
- **Built for many teams**: monorepo, polyrepo or hybrid layouts, ownership
  manifests, compatibility and bundle-budget checks.

## Repos

| Repo                                                    | What                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| [mfeflow/mfeflow](https://github.com/mfeflow/mfeflow)   | this monorepo: packages, CLI, features, docs           |
| [mfeflow/starter](https://github.com/mfeflow/starter)   | a ready-to-use project, generated by the CLI           |
| [mfeflow/examples](https://github.com/mfeflow/examples) | real-world examples (ecommerce, dashboard, multi-repo) |

## Development

```bash
corepack enable
pnpm install
pnpm ci        # format, lint, typecheck, test, build
```

See [CONTRIBUTING](https://github.com/mfeflow/.github/blob/main/CONTRIBUTING.md).

## Licence

[MIT](LICENSE)
