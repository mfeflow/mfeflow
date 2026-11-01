---
title: Add a remote
description: Step-by-step tutorial for adding a third remote to an mfeflow project with the add remote command, then running it in the shell and checking the result.
---

# Add a remote

This tutorial adds a remote called `checkout` to the project from the [Quickstart](/guide/quickstart). By the end it will appear in the shell at its own route. The same steps work for any name.

## Before you start

You need a project made by `create-mfeflow` with dependencies installed. Run the commands from the project root.

## 1. Preview the change

Ask the CLI what it would do, without writing anything:

```bash
pnpm mfeflow add remote checkout --dry-run
```

You should see a summary, a list of files and the diff for each:

```text
21 to create, 2 to patch, 0 to delete
  create  apps/checkout/mfe.json
  create  apps/checkout/package.json
  create  apps/checkout/rsbuild.config.ts
  create  apps/checkout/src/exposed/App.tsx
  ...
  create  apps/shell/src/remotes/checkout.tsx
  patch   apps/shell/src/remotes/route-table.tsx
  create  registry/envs/dev/checkout.json
  create  registry/envs/prod/checkout.json
  create  registry/envs/staging/checkout.json
  patch   mfeflow.json
```

The two patched files are the shell's route table and `mfeflow.json`. No other app changes.

## 2. Create the remote

Run the same command without `--dry-run`:

```bash
pnpm mfeflow add remote checkout --yes
```

It writes the files, installs dependencies and prints the last line:

```text
Added checkout (remote).
```

If you already added features, the new remote gets them too. With event-bus installed, for example, the remote depends on your contracts package.

## 3. Check what it chose

The CLI picks the next free port, starting from 4311 for remotes. Open the new `mfe.json`:

```json title="apps/checkout/mfe.json"
{
  "name": "checkout",
  "owner": "team-checkout",
  "shells": ["shell"],
  "routes": ["/checkout"],
  "exposes": ["./App"]
}
```

Change `owner` to the real team. The route `/checkout` is already in the shell's route table. To pick a port yourself, pass `--port 4320` to the command.

## 4. Run it

Start the project:

```bash
pnpm mfeflow dev
```

You should see the new app start with the others, with its own prefix:

```text
mfeflow: running shell, catalog, cart, checkout. Ctrl+C stops everything.
```

Open `http://localhost:4300/checkout`. You should see the placeholder App of the new remote. If `mfeflow dev` was already running, it picks up the new remote without a restart.

## 5. Verify

Run the checks:

```bash
pnpm mfeflow validate
```

You should see `ok` lines and no errors:

```text
ok    every app has a valid mfe.json that matches mfeflow.json
ok    no two remotes claim overlapping routes
ok    every remote has a valid registry entry in dev, staging and prod
0 error(s), 0 warning(s), 0 skipped
```

## If something fails

- A name error (E215) means the name is not a valid Module Federation name. Use lowercase letters, digits and underscores.
- An overlapping route error (E116) means another remote already claims the path.
- The remote does not start in `dev`: run `pnpm install`. See [Troubleshooting](/guide/troubleshooting).

## What you did

You added an app, three registry files and a route. Before you deploy, replace the example hosts in the staging and prod registry files. See [Deploy](/guide/deploy/).

For all options of the command, see the [CLI reference](/reference/cli#add).
