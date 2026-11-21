---
title: mfeflow vs Nx Module Federation
description: An explanation of how mfeflow and the Nx Module Federation generators differ, what Nx does well, when to pick which, and what has not been checked.
---

# mfeflow vs Nx Module Federation

Pick Nx if you want one tool for the whole workspace, a choice of Vite, Rsbuild or Rspack, or you already use Nx. Pick mfeflow if you want a rollback-by-pointer registry from day one and drift, ownership and size checks around Module Federation. This page is a comparison, not a benchmark. We make no claim that one is faster, smaller or better.

The Nx facts below were read from nx.dev, GitHub and the npm registry on 2026-11-05, and the Nx 24 parts on 2026-11-21. We did not run Nx for this page.

## What is Nx?

Nx is a build system and workspace tool for monorepos. It is MIT licensed. It does far more than micro-frontends: task running, a project graph, generators for many kinds of projects, and an optional hosted service, Nx Cloud, which has a free tier.

For React Module Federation it ships generators. Nx 23, released on 2026-06-16, added `consumer` and `provider` generators, which "wire up the official Module Federation plugins directly". See [consumer and provider](https://nx.dev/docs/kb/consumer-and-provider) and the [23.0.0 release notes](https://github.com/nrwl/nx/releases/tag/23.0.0).

Nx 24, released on 2026-10-21, removed Nx's own Module Federation support: "Nx Module Federation removed, including the React and Angular `host` and `remote` generators" ([changelog](https://nx.dev/changelog)). The removed parts include:

- `withModuleFederation` and `NxModuleFederationPlugin`
- `loadRemoteModule` and `setRemoteDefinitions` from `@nx/react/mf`
- the `module-federation-dev-server` and static-server executors
- `sharePackages` and `shareWorkspaceLibraries`

Existing `host`/`remote` workspaces move to a plain `ModuleFederationPlugin` config by following [Migrate from Nx Module Federation](https://nx.dev/docs/kb/migrate-from-nx-module-federation). After that move, the guide notes that "the host no longer starts its remotes".

## What Nx does well

Nx is the stronger choice if you want one tool for the whole workspace. It is not only a Module Federation tool, and it does not need to be.

- **A full workspace.** One tool covers task running, the project graph and generators, for micro-frontends and for everything else in the repo.
- **A choice of bundler.** Both new generators take a `--bundler` flag. The default is Vite. Rsbuild and Rspack are the other options. The choice is made when you generate the project and cannot be changed later.
- **Runtime registration.** Remotes are registered at runtime from a list of providers (a `PROVIDERS` array in `src/mf.ts`). There is no remotes list baked into the build, and a missing provider renders an inline fallback instead of crashing the consumer.
- **Manifest files.** `mf-manifest.json` works for production builds, and for Rspack and Rsbuild dev servers. With Vite it exists only at build time.
- **Ports and names are flags.** A provider is generated only when you ask for one.

## What mfeflow does differently

mfeflow is narrower. It only does micro-frontends. It builds with Rsbuild by default, and with Vite if you pass `--bundler vite`.

- **A registry index.** The shell reads a JSON list of remotes with their entry URLs at boot. See [The registry index](/concepts/registry-index).
- **Rollback by pointer.** `mfeflow rollback` changes one registry entry to an earlier version. Nothing is rebuilt. See [Deploy and roll back a remote](/guide/deploy-and-rollback).
- **Checks that keep settings consistent.** `mfeflow doctor` fails when shared package versions drift. `validate` checks routes. `budget` measures JavaScript size.
- **Features as file changes.** Analytics, theming and similar parts arrive one at a time. See [Add features](/guide/adding-features).

On deployment, Nx's own 2024 post says it ["left deployment unaddressed"](https://nx.dev/blog/next-gen-module-federation-deployment) and points to Zephyr Cloud, which lists version rollback and roll-forward. We found no built-in rollback in Nx. That is a gap in what we found, not proof that none exists.

## When to pick which

Pick Nx when:

- you want one workspace tool for more than micro-frontends
- you want to choose Vite, Rsbuild or Rspack
- you already use Nx

Pick mfeflow when:

- you want a rollback-by-pointer registry from the first day
- you are fine with Rsbuild or Vite, React, client-side rendering and pnpm
- you want drift, ownership and size checks around Module Federation

The two are not exclusive in principle. mfeflow uses Turborepo for its tasks and says nothing against other monorepo tools in the same repository. We have not tried putting a generated mfeflow project inside an Nx workspace.

## Coming from Nx `host` and `remote`

If your workspace uses `withModuleFederation`, Nx 24 asks you to rewrite the federation config by hand. Nx's guide does that and keeps your bundler. mfeflow is another option: it gives you `mfeflow dev` to start the shell and remotes together, a registry with rollback, and fallbacks when a remote is down. `mfeflow adopt` does not read Nx's `withModuleFederation` configs yet. That work is planned, and until it ships, Nx's guide is the path to follow.

## What we have not checked

- Whether the `consumer` and `provider` generators stay in Nx 24. The Nx 24 notes name only `host` and `remote` as removed, but no page says outright that the other two remain.
- Whether Nx has a codemod to move from `host` and `remote` to `consumer` and `provider`. We found none, but did not read every page.
- How Nx behaves in production. We read documentation only.
- Server-side rendering in Nx. The documentation says it is not first-class.
- The current Nx Cloud price. The pricing page contradicts itself, so we quote none.

Found an error? Open an issue on [GitHub](https://github.com/mfeflow/mfeflow).
