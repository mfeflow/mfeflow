---
title: Why try mfeflow
description: The problem mfeflow solves, a measured example, when you should not use micro-frontends at all, and a facts-only comparison with plain Module Federation and monorepo tools.
---

# Why try mfeflow

This page helps you decide whether mfeflow is worth an afternoon. It is an explanation page. It covers the problem, what mfeflow does about it, and where it stops.

## What is the problem?

Module Federation lets one web app load code from another at runtime. The first demo works in an hour. The cost shows up later, in settings that nobody owns.

Here is one measured example. The storefront example in this repository is a shell with two remotes. We measured the same page as one app and as a federated app, with Lighthouse on a mobile profile, median of 10 runs. The source is `examples/storefront/e2e/perf-summary.json`, an earlier run from 2026-10-31. The current budget check is in [The cost model](/concepts/cost-model).

| Setup                                                                                      | Largest contentful paint added |
| ------------------------------------------------------------------------------------------ | ------------------------------ |
| Step 0: plain federation, no ESM runtime, remote code kept, manifests, no inlined registry | +1089 ms                       |
| Final step: the mfeflow settings, plus an inlined registry and preload hints               | +161 ms                        |

Nothing in the first row is broken. It loads more code, in more steps, than it has to. The six steps in between are listed in the same file. Two of the later steps, the inlined registry and preload hints, come from the example's own server, not from the generated project.

## What does mfeflow do?

It starts you from the second row. The generated project has the preset, the shared packages and the checks already in place. Then it keeps checking them.

- **A working layout.** One shell and several remotes, a dev server that runs them together, and a registry that tells the shell where each remote lives.
- **Shared packages that stay single.** React and the mfeflow packages load once. `doctor` fails when versions drift.
- **Features you add one at a time.** Analytics, telemetry, theming and more arrive as reviewed file changes. See [Add features](/guide/adding-features).
- **Ownership and budgets.** Each app has an owner in `mfeflow.app.json`. A budget check measures JavaScript size.

## Do I need micro-frontends at all?

Maybe not. Martin Fowler's article on micro-frontends says to consider whether you have the technical and organisational maturity before you start.

Ask these questions first:

- Do several teams change the same front end, and do they block each other's releases?
- Does a release of one area need to happen without testing all the others?
- Can you accept more moving parts in return for that independence?

If the answer to the first two is no, build one app. You can split it later.

## What does mfeflow not do?

It does not make a bad split good. If your teams cut the product along the wrong lines, you will have the same coupling in more places.

Some things are not built yet or are out of scope for this release:

- Deploy, promote and rollback commands. They are planned for Phase 05. See [Deploy](/guide/deploying).
- Frameworks other than React, and server-side rendering.
- CSS isolation between remotes beyond what the `tailwind` feature gives you.
- A package manager other than pnpm.

The [FAQ](/guide/faq) answers each of these in detail.

## How does it compare?

This table lists what each option gives you out of the box. It does not rate quality. Check each project's own docs for their current features.

| Out of the box                           | Module Federation by hand | create-module-federation            | mfeflow                                 |
| ---------------------------------------- | ------------------------- | ----------------------------------- | --------------------------------------- |
| Host and remote apps                     | You write them            | A host and a remote from a template | A shell and remotes, any number         |
| Add another remote later                 | You copy and edit config  | Not part of the tool                | `mfeflow add remote`                    |
| Singletons for React and shared packages | You list them             | You list them                       | Preconfigured, checked by `doctor`      |
| Registry the shell reads at boot         | You design it             | Not part of the tool                | A registry index with a validated shape |
| Local dev with every app running         | You write scripts         | Per-app scripts                     | `mfeflow dev`                           |
| Ownership and route checks               | You write them            | Not part of the tool                | `mfeflow.app.json`, `validate`          |
| Budget check                             | You write it              | Not part of the tool                | `mfeflow budget`                        |
| Optional features as file changes        | None                      | None                                | 20 features and registries for more     |

Monorepo tools solve a different problem.

| Tool      | What it gives you                                                               |
| --------- | ------------------------------------------------------------------------------- |
| Turborepo | A task runner with caching. It does not configure Module Federation.            |
| Nx        | A task runner with a project graph, plus generators for Module Federation apps. |

mfeflow uses Turborepo for its tasks. You can keep using Nx or Turborepo's other features in the same repository.

## When not to use mfeflow

Skip mfeflow in these cases:

- You have one team and one deploy. A single app is simpler.
- You need Next.js or server rendering today. mfeflow builds client-rendered apps with Rsbuild.
- Your remotes use different frameworks. The shared singleton design assumes one React.
- You need npm or Yarn. This release supports pnpm only.
- You need a finished deploy and rollback workflow now. Only the design exists.

If none of those apply, start with the [Quickstart](/guide/quickstart).
