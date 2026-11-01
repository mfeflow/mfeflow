---
title: Introduction to mfeflow
description: What mfeflow is, who it is for, and how it handles the problems that appear after the first week of running React micro-frontends with Module Federation.
---

# Introduction to mfeflow

This page explains what mfeflow is and whether it fits your team. It is an explanation page, so it has no commands. To build something, go to the [Quickstart](/guide/quickstart).

## What is mfeflow?

mfeflow is a command line tool and a set of small packages for React micro-frontends. It creates a monorepo with one shell and several remotes, built with Rsbuild and Module Federation 2. After that, it adds features and checks the project so the setup stays healthy.

The shell is the page that loads first. A remote is a separate app that the shell loads at runtime. Each remote can be built and deployed on its own.

## Who is it for?

mfeflow is for React teams who have decided to split a front end into pieces that ship independently. It also suits teams who already run Module Federation by hand and keep fixing the same problems.

You should know React, npm and CI. You do not need to know Module Federation. The [Module Federation concept page](/concepts/module-federation) covers what you need.

## Who is it not for?

A single small app does not need micro-frontends. One team, one release train and one repository is simpler without them.

mfeflow also does not fit if you need a framework other than React, server-side rendering, or a package manager other than pnpm. Those limits are in the [FAQ](/guide/faq). Read [Why try mfeflow](/guide/why-mfeflow) for the longer version of this question.

## What breaks after day one?

Getting a shell to load one remote is easy. The trouble starts when the second team joins and the first release goes out. These are the problems mfeflow targets.

| Problem                  | What you see                                         | What mfeflow does                                                                   |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Two copies of React      | "Invalid hook call" in the browser                   | Shares React and other packages as singletons by default. `doctor` checks versions. |
| Version drift            | A remote asks for a React the shell does not provide | `check-compat` compares each remote with its shell.                                 |
| Tag manager loaded twice | Double page views and doubled consent prompts        | One feature owns analytics in the shell. Remotes only send events.                  |
| No owner                 | Nobody knows who to page for the broken cart         | Every app has an `mfeflow.app.json` with an owner and routes.                       |
| Bundle creep             | The shell gets heavier with each remote              | `budget` measures JS against a stated budget.                                       |
| Rollback needs a rebuild | A bad release means building the old one again       | The registry design points at a build instead. This part is not built yet.          |

## How do the pieces fit together?

Three things make up the platform. The CLI creates and changes the project. The packages under `@mfeflow/*` run in the browser, such as the runtime that loads remotes. The registry tells the shell which remote builds exist.

```text
 mfeflow CLI            @mfeflow/* packages            your repo
 -----------            -------------------            ---------
 init, add          ->  runtime, rsbuild preset   ->   apps/shell
 doctor, budget         event-bus, analytics ...       apps/<remote>
 dev, validate                                         registry/envs/*
```

[How it works](/guide/how-it-works) walks through the boot sequence in detail.

## Next steps

- Build a project: [Quickstart](/guide/quickstart).
- See every file it creates: [Project structure](/guide/project-structure).
- Compare it with the alternatives: [Why try mfeflow](/guide/why-mfeflow).
