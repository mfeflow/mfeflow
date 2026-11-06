---
title: mfeflow vs Nx Module Federation
description: An explanation of how mfeflow and the Nx Module Federation generators differ, what Nx does well, when to pick which, and what has not been checked.
---

# mfeflow vs Nx Module Federation

This page explains how mfeflow differs from the Module Federation support in Nx, so you can pick one. It is an explanation page, not a benchmark. We make no claim that one is faster, smaller or better.

The Nx facts below were read from nx.dev, GitHub and the npm registry on 2026-11-05. We did not run Nx for this page.

## What is Nx?

Nx is a build system and workspace tool for monorepos. It is MIT licensed. It does far more than micro-frontends: task running, a project graph, generators for many kinds of projects, and an optional hosted service, Nx Cloud, which has a free tier.

For React Module Federation it ships generators. The older `host` and `remote` generators are deprecated. Nx 23, released on 2026-06-16, added `consumer` and `provider` generators instead. See [consumer and provider](https://nx.dev/docs/kb/consumer-and-provider) and the [23.0.0 release notes](https://github.com/nrwl/nx/releases/tag/23.0.0).

## What Nx does well

Nx is the stronger choice if you want one tool for the whole workspace. It is not only a Module Federation tool, and it does not need to be.

- **A full workspace.** One tool covers task running, the project graph and generators, for micro-frontends and for everything else in the repo.
- **A choice of bundler.** Both new generators take a `--bundler` flag. The default is Vite. Rsbuild and Rspack are the other options. The choice is made when you generate the project and cannot be changed later.
- **Runtime registration.** Remotes are registered at runtime from a list of providers in `src/mf.ts`. There is no remotes list baked in at build time, and a missing provider does not crash the consumer.
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
- you are fine with Rsbuild, React, client-side rendering and pnpm
- you want drift, ownership and size checks around Module Federation

The two are not exclusive in principle. mfeflow uses Turborepo for its tasks and says nothing against other monorepo tools in the same repository. We have not tried putting a generated mfeflow project inside an Nx workspace.

## What we have not checked

- Whether Nx 24 removed the `host` and `remote` generators. The Nx 24.0.0-beta.3 notes only mention removing Nx Module Federation and moving to official plugins. We could not confirm the details on nx.dev.
- Whether Nx has a codemod to move from `host` and `remote` to `consumer` and `provider`. We found none, but did not read every page.
- How Nx behaves in production. We read documentation only.
- Server-side rendering in Nx. The documentation says it is not first-class.
- The current Nx Cloud price. The pricing page contradicts itself, so we quote none.

Found an error? Open an issue on [GitHub](https://github.com/mfeflow/mfeflow).
