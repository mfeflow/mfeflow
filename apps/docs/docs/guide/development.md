---
title: Develop locally
description: Run the shell and every remote with mfeflow dev, point one remote at a server you already run, override a remote from the browser, and use doctor to find and fix problems.
---

# Develop locally

This guide shows how to run a project on your machine and how to work on one remote without running the rest. Each section is a task. For the reasons behind the dev setup, read [How it works](/guide/how-it-works#how-does-development-differ-from-production).

## Run everything

Start the shell and every remote from the project root:

```bash
pnpm mfeflow dev
```

You should see one prefixed log line per app. The shell serves on port 4300. Remotes start at 4311 and count up. Press Ctrl+C to stop every app.

The command writes a dev registry to `.mfeflow/dev-registry.json`, built from `registry/envs/dev`, and watches the project. If you add a remote while it runs, the new app starts and the shell lists it.

## Run only some apps

Start the shell and one remote:

```bash
pnpm mfeflow dev --only shell,catalog
```

Only those apps start. The dev registry still lists every remote, so a remote that is not running shows its fallback in the shell.

## Use a remote you already run

Say your colleague runs `checkout` on port 3001, or you started it by hand. Point the shell at it:

```bash
pnpm mfeflow dev --remote checkout=http://localhost:3001
```

A bare origin means `/mf-manifest.json` on that server. The remote is not started, and the shell loads it from your URL. Repeat the flag for more remotes.

A remote on another host needs permission. Name the origin:

```bash
pnpm mfeflow dev \
  --remote checkout=https://dev.example.com \
  --allow-origin https://dev.example.com
```

Without `--allow-origin`, any host except localhost is refused (E107).

To see the plan without starting anything, add `--dry-run`. You should see the command for each app and the dev registry:

```text
shell: pnpm run dev in apps/shell (port 4300)
checkout: uses http://localhost:3001/mf-manifest.json
```

## Override a remote from the browser

You can swap one remote for your local build without changing any file. Add a query parameter to the shell's URL:

```text
http://localhost:4300/cart?mfe-override=cart@http://localhost:4312/mf-manifest.json
```

The override lasts for the browser session. Open any URL with `?mfe-override=reset` to clear it. Separate several overrides with commas.

Overrides only work in development builds, and only for `localhost` and `127.0.0.1`. In a production build the parameter is ignored, and the runtime reports that it was.

## Open the dev panel

The generated shell shows a small panel in development. It lists the registered remotes, marks overridden ones and shows load errors. Press Alt+Shift+M to open or close it.

## Find problems with doctor

Run the doctor when something looks wrong:

```bash
pnpm mfeflow doctor
```

You should see one line per check. A passing run ends with:

```text
0 error(s), 0 warning(s), 0 skipped
```

The checks cover app folders, `mfeflow.app.json` files, ports, routes, registry entries, singleton versions, workspace package versions, remote compatibility, copied-file drift, runtime plugins and the env files. Each failure prints a code, a fix and a link to its [error page](/reference/errors).

Some problems are safe to repair. Ask the doctor to fix them:

```bash
pnpm mfeflow doctor --fix
```

`--fix` writes a missing `version` into a workspace package (E111) and creates missing registry entry files (E114). Nothing else is changed. Add `--dry-run` to see the diff first.

## What next?

- See every flag: [CLI reference](/reference/cli).
- A command fails: [Troubleshooting](/guide/troubleshooting).
- Run the same checks in CI: [CI and budgets](/guide/ci-and-budgets).
