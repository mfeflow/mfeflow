---
title: mfeflow vs create-mf-app
description: An explanation of how mfeflow differs from the create-mf-app starter, what create-mf-app offers, when to pick which, and what has not been checked.
---

# mfeflow vs create-mf-app

This page explains how mfeflow differs from `create-mf-app`, so you can pick one. It is an explanation page, not a benchmark. We make no claim that one is faster, smaller or better.

The `create-mf-app` facts below were read from its GitHub page and the npm registry on 2026-11-05. We did not run it for this page.

## What is create-mf-app?

[create-mf-app](https://github.com/jherr/create-mf-app) is a starter that generates Module Federation projects from templates. It lives under one maintainer's GitHub account, not under the Module Federation organisation.

On npm, version 2.0.4 was published on 2025-06-05 under the MIT license. The last commit we saw was from June 2025, although the commits page we read may have been out of date.

## What it does well

It is small and quick to try. The README says it creates an app, an API server or a library from templates. You choose options on the command line, for example `--template react-19` or `--css Tailwind`.

For learning how Module Federation fits together, or for a throwaway experiment, a small starter is a good fit. It asks you to adopt nothing else.

## What mfeflow does differently

mfeflow does more after the first project exists. It is for teams that will keep several remotes running over time. It builds with Rsbuild today.

- **More than the first scaffold.** `mfeflow add remote` adds another remote later. See [Add a remote](/guide/adding-a-remote).
- **A registry index.** The shell reads a JSON list of remotes at boot, and `mfeflow rollback` points an entry at an earlier version. See [Deploy and roll back a remote](/guide/deploy-and-rollback).
- **Checks.** `doctor`, `validate` and `budget` look for drifting versions, route clashes and size growth.
- **Features as file changes.** See [Add features](/guide/adding-features).

The tradeoff is size. mfeflow asks you to accept React, client-side rendering, Rsbuild and pnpm. It has more commands to learn.

## When to pick which

Pick `create-mf-app` when you want a small template to learn from or to try an idea, and you are happy to build the rest yourself. Its own README says: "These projects are not production complete."

Pick mfeflow when you expect several teams, several remotes and releases that happen on different days.

If you start with `create-mf-app` and the project grows, [Bring an existing app](/guide/adopt) covers projects with a host built with Rsbuild, Rspack or webpack. We do not know which bundler `create-mf-app` uses, and we have not tried this path.

## What we have not checked

- Whether `create-mf-app` makes a host and a remote together. We did not find this in what we read.
- Which bundler its templates use. We did not find this either.
- Whether any maintainer activity happened after June 2025 that we missed.
- How its generated projects behave when run or deployed.

Found an error? Open an issue on [GitHub](https://github.com/mfeflow/mfeflow).
