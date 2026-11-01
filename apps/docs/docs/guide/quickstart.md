---
title: Quickstart
description: Create an mfeflow project, run the shell and two remotes locally, add a feature, then run the doctor and budget checks. About ten minutes.
---

# Quickstart

This tutorial takes you from an empty folder to a running shell with two remotes. You will add a feature and run two checks. It takes about ten minutes.

## Before you start

You need Node.js 22.12 or newer and pnpm. The generated project pins the pnpm version it was made with. For 0.4.0 that is 12.16.1.

Check your versions:

```bash
node --version
pnpm --version
```

You should see something like this:

```text
v22.23.4
12.16.1
```

If pnpm is missing, run `corepack enable`. Corepack reads the pinned version from the project. The CLI does not check these versions itself, so an old Node or pnpm fails later with a less clear message.

## 1. Create the project

Run the creator with the name of the folder:

```bash
pnpm create mfeflow demo --yes
```

`--yes` takes the defaults and skips the questions. It installs dependencies at the end, so this takes a few seconds. You should see a line like this:

```text
Created /path/to/demo with a shell and 2 remotes (catalog, cart).
```

The default project has a shell and two remotes called `catalog` and `cart`. It also has four features turned on: lint-oxlint, url-factory, env-t3 and testing. Go into the folder:

```bash
cd demo
```

## 2. Start everything

Start the shell and both remotes together:

```bash
pnpm mfeflow dev
```

You should see one log line per app, each with a prefix. The first lines are:

```text
mfeflow: running shell, catalog, cart. Ctrl+C stops everything.
shell   | $ rsbuild dev
catalog | $ rsbuild dev
cart    | $ rsbuild dev
```

A few seconds later each app prints its address:

```text
cart    |   ➜  Local:    http://localhost:4312/
catalog |   ➜  Local:    http://localhost:4311/
shell   |   ➜  Local:    http://localhost:4300/
```

Module Federation also prints a note about CORS headers for each remote. That is expected in development.

## 3. Open the shell

Open `http://localhost:4300` in your browser. You should see a header with the project name and three links: home, catalog and cart. The home page shows both remotes, one under the other.

Click catalog. You should see a heading "catalog" and a button that says "Clicked 0 times". That button belongs to the catalog remote. The shell loaded it from `localhost:4311` while the page was open.

Stop the dev server with Ctrl+C. See [Develop locally](/guide/development) for ports and overrides.

## 4. Add a feature

Features are added with one command. First look at what the change would be, without writing anything:

```bash
pnpm mfeflow add event-bus --dry-run
```

You should see a summary, then the list of files and a diff for each one:

```text
11 to create, 7 to patch, 0 to delete
  patch   apps/cart/package.json
  create  apps/cart/src/Announce.tsx
  create  apps/cart/src/events.ts
  ...
  create  packages/contracts/src/events/index.ts
  patch   mfeflow.json
```

Nothing was written. Now apply it and install:

```bash
pnpm mfeflow add event-bus --yes
```

You should see the same list and then this line:

```text
Added event-bus.
```

The feature also created a shared contracts package for event types. [Add features](/guide/adding-features) explains the plan, the diff and the rollback.

## 5. Run the checks

The doctor checks the project for the problems that cause trouble later. Run it:

```bash
pnpm mfeflow doctor
```

You should see one line per check and a summary. The first and last lines:

```text
ok    every app in mfeflow.json is on disk
...
0 error(s), 0 warning(s), 0 skipped
```

The budget check needs a build first. Build, then measure:

```bash
pnpm build
pnpm mfeflow budget
```

You should see the JavaScript size of the shell and each remote:

```text
Initial JS, gzip (1 KB = 1024 bytes):
  shell shell: 99.8 KB in 2 scripts, no baseline set (budget.baselineKb), not checked
  remote catalog: entry 7.1 KB, limit 10
  remote cart: entry 7 KB, limit 10
LCP (+300 ms) is measured by the perf job, not here.
```

The numbers above came from the 0.4.0 default project, before adding event-bus. Yours may differ slightly. [CI and budgets](/guide/ci-and-budgets) explains what the limits mean.

## What you built

You have a pnpm monorepo with a shell, two remotes, a dev registry and a set of checks. Each remote can be built and deployed on its own.

## Next steps

- Read every generated file: [Project structure](/guide/project-structure).
- Add a third remote: [Add a remote](/guide/adding-a-remote).
- Understand the boot sequence: [How it works](/guide/how-it-works).
- Something failed: [Troubleshooting](/guide/troubleshooting).
