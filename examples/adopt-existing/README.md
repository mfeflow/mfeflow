# Adopt an existing app

A small Module Federation app that does not use mfeflow. Use it to try `mfeflow adopt` on something safe before you run it on your own project.

This is a tutorial. The [adopt guide](../../apps/docs/docs/guide/adopt.md) explains what `adopt` reads and writes.

## What is in it

One shell and two remotes, in a pnpm workspace. React 19 everywhere. Every Module Federation setting is a literal value in the config.

```text
adopt-existing/
  pnpm-workspace.yaml
  apps/
    shell/      Rsbuild + pluginModuleFederation, port 3000
    catalog/    Rsbuild + pluginModuleFederation, exposes ./ProductList, port 3001
    checkout/   Rspack + ModuleFederationPlugin, exposes ./Checkout, port 3002
```

The shell loads both remotes from their `mf-manifest.json`. Nothing here imports an `@mfeflow` package.

## Prerequisites

- Node 22.12 or newer
- pnpm 12 or newer

## 1. Check that it works without mfeflow

Copy the folder out of the mfeflow checkout, so the steps below do not change the repo. Then install and build:

```bash
cp -R examples/adopt-existing ~/plain-shop
cd ~/plain-shop
pnpm install
pnpm build
```

You should see `Done` from each of the three apps. Run `pnpm dev` and open `http://localhost:3000` to see the catalog and the checkout button inside the shell. Stop it with Ctrl+C.

## 2. Preview the change

A dry run writes nothing. It lists what `adopt` would do:

```bash
npx mfeflow adopt --dry-run
```

You should see this list first, then the diff of every file:

```text
10 to create, 1 to patch, 0 to delete
  create  apps/catalog/mfeflow.app.json
  create  apps/checkout/mfeflow.app.json
  create  apps/shell/mfeflow.app.json
  patch   apps/shell/package.json
  create  registry/envs/dev/catalog.json
  create  registry/envs/dev/checkout.json
  create  registry/envs/prod/catalog.json
  create  registry/envs/prod/checkout.json
  create  registry/envs/staging/catalog.json
  create  registry/envs/staging/checkout.json
  create  mfeflow.json
Dependencies (1):
  apps/shell/package.json  @mfeflow/runtime@^0.5.0
Warning: routes are empty (mfeflow cannot read them from a build config); ...
Warning: registry entries for staging and prod point at example.com; ...
```

The list ends with a note that your build config was not changed. That is a promise: `adopt` never edits `rsbuild.config.ts` or `rspack.config.mjs`.

```text
Your build config was not changed (apps/catalog/rsbuild.config.ts,
apps/checkout/rspack.config.mjs, apps/shell/rsbuild.config.ts). adopt never
edits it.
To share the runtime as a singleton, add this line to the shared list in the
shell's config:

    '@mfeflow/runtime': { singleton: true },

Dry run: nothing was written.
```

This example has nothing in the "not carried over" list. A project that sets `shareStrategy` or builds its remotes from a function would see them listed there.

## 3. Write the files

Run it again with `--yes`. This writes the files and installs the new dependency:

```bash
npx mfeflow adopt --yes
```

You should see the same summary, then the next steps:

```text
Next:
  set the owner and the routes in each mfeflow.app.json
  mfeflow validate
  mfeflow doctor
```

Look at `apps/catalog/mfeflow.app.json`. The exposed module and the React range came from the build config:

```json
{
  "name": "catalog",
  "owner": "unassigned",
  "shells": ["shell"],
  "routes": [],
  "exposes": ["./ProductList"],
  "platform": { "react": "^19.0.0", "react-dom": "^19.0.0" }
}
```

`adopt` cannot know who owns an app or which paths it serves. Set `owner` and `routes` yourself.

## 4. Validate

Check the project the way CI does:

```bash
npx mfeflow validate
```

You should see:

```text
ok    every app in mfeflow.json is on disk
ok    every app has a valid mfeflow.app.json that matches mfeflow.json
ok    no two remotes claim overlapping routes
ok    every remote has a valid registry entry in dev, staging and prod

0 error(s), 0 warning(s), 0 skipped
```

## 5. Run it

Start the shell and both remotes with one command:

```bash
npx mfeflow dev
```

You should see each app's own dev server, prefixed with its name:

```text
mfeflow: running catalog, checkout, shell. Ctrl+C stops everything.
catalog  | $ rsbuild dev
shell    | $ rsbuild dev
checkout | $ rspack serve
shell    |   ➜  Local:    http://localhost:3000/
catalog  |   ➜  Local:    http://localhost:3001/
checkout |   ➜  Local:    http://localhost:3002/
```

The shell still loads its remotes from the URLs in its own config. To load them through the registry at run time, switch the shell to `@mfeflow/runtime`. That step is not part of `adopt`.

## What you built

A plain app that mfeflow now knows about: a project file, an ownership file for each app, and a registry entry for each remote. Your build files are byte for byte what you started with.

The repo tests this. `packages/cli/src/commands/adopt-example.test.ts` copies this folder to a temp directory, adopts it, checks the files above, validates, and compares the build files before and after.

## Next

- Read the [adopt guide](../../apps/docs/docs/guide/adopt.md) for the settings `adopt` does not carry over.
- Learn how the [shell finds a remote](../../apps/docs/docs/guide/how-it-works.md).
- Deploy one remote without the others with [Deploy and roll back](../../apps/docs/docs/guide/deploy-and-rollback.md).
