---
title: Quickstart
description: Go from an empty folder to a running mfeflow shell and two remotes, add a third remote while dev runs, then add a feature and run the checks. Ten minutes.
---

# Quickstart

This tutorial takes you from an empty folder to a running shell with two remotes. You will see what each port serves, add a third remote while the dev server keeps running, add a feature and run two checks. It takes about ten minutes.

## Before you start

You need Node.js 22.12 or newer and pnpm. The generated project pins the pnpm version it was made with. For 0.8.0 that is 12.16.1.

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
Next:
  cd demo
  pnpm dev
```

The creator prints the list of scripts it added before this. The `pnpm dev` hint is the plain way to start the apps. The next step uses `pnpm mfeflow dev` instead, which also builds the dev registry and watches for new remotes.

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

With `--bundler vite` each line says `vite` instead. A few seconds later each app prints its address:

```text
cart    |   ➜  Local:    http://localhost:4312/
catalog |   ➜  Local:    http://localhost:4311/
shell   |   ➜  Local:    http://localhost:4300/
```

Module Federation also prints a note about CORS headers for each remote. That is expected in development.

Each app is a separate dev server on its own port:

| Port | App     | What you see in the browser                             |
| ---- | ------- | ------------------------------------------------------- |
| 4300 | shell   | The whole page: header, links and the remotes           |
| 4311 | catalog | A blank page. The remote only serves files to the shell |
| 4312 | cart    | A blank page, for the same reason                       |

You can check the remotes from a terminal. The shell lists them in the page it serves, and each remote publishes a manifest:

```bash
curl -s localhost:4300/ | grep -o '__MFE_REGISTRY__=[^<]*'
curl -s localhost:4311/mf-manifest.json | head -c 120
```

```text
__MFE_REGISTRY__={"remotes":[{"name":"cart","entry":"http://localhost:4312/mf-manifest.json","version":"dev"},{"name":"catalog","entry":"http://localhost:4311/mf-manifest.json","version":"dev"}]}
{
  "id": "catalog",
  "name": "catalog",
  "metaData": {
    "name": "catalog",
    "globalName": "catalog",
    "buildInfo": {
```

## 3. Open the shell

Open `http://localhost:4300` in your browser. You should see a header with the project name and three links: home, catalog and cart. The home page shows both remotes, one under the other.

Click catalog. You should see a heading "catalog" and a button that says "Clicked 0 times". That button belongs to the catalog remote. The shell loaded it from `localhost:4311` while the page was open.

Click cart and you get the same thing for the cart remote. Leave the dev server running for the next step. See [Develop locally](/guide/development) for ports and overrides.

## 4. Add another remote

Open a second terminal in the same folder and add a remote called `reviews`:

```bash
pnpm mfeflow add remote reviews --yes
```

It writes the new app, adds a route to the shell and installs its dependencies. It ends with:

```text
Added reviews (remote).
```

Go back to the first terminal. You do not restart anything. The dev command notices the new app and starts it on port 4313:

```text
mfeflow: starting reviews on 4313
reviews | $ rsbuild dev
reviews |   ➜  Local:    http://localhost:4313/
reviews | ready   built in 0.33s
```

Reload `http://localhost:4300`. The header now has a fourth link, reviews, and the home page shows a third block. Open `http://localhost:4300/reviews` for the route on its own. The shell's registry lists the new remote too:

```text
__MFE_REGISTRY__={"remotes":[{"name":"cart", ... },{"name":"catalog", ... },{"name":"reviews","entry":"http://localhost:4313/mf-manifest.json","version":"dev"}]}
```

The generated remote is a heading and a counter button, so you can see it load before you write any code. [Add a remote](/guide/adding-a-remote) covers the preview, the owner file and the options. Stop the dev server with Ctrl+C when you are done.

## 5. Add a feature

Features are added with one command. First look at what the change would be, without writing anything:

```bash
pnpm mfeflow add event-bus --dry-run
```

You should see a summary, then the list of files and a diff for each one:

```text
14 to create, 9 to patch, 0 to delete
  patch   apps/cart/package.json
  create  apps/cart/src/Announce.tsx
  create  apps/cart/src/events.test.ts
  create  apps/cart/src/events.ts
  ...
  create  packages/contracts/src/events/index.ts
  patch   mfeflow.json
```

With the reviews remote from the last step, the feature touches all four apps. Nothing was written yet. Now apply it and install:

```bash
pnpm mfeflow add event-bus --yes
```

You should see the same list and then this line:

```text
Added event-bus.
```

The feature also created a shared contracts package for event types. [Add features](/guide/adding-features) explains the plan, the diff and the rollback.

## 6. Run the checks

The doctor checks the project for the problems that cause trouble later. Run it:

```bash
pnpm mfeflow doctor
```

You should see one line per check and a summary. The first and last lines:

```text
ok    every app in mfeflow.json is on disk
...
0 error(s), 1 warning(s), 1 skipped
```

The skipped check is about a linked local checkout of mfeflow, which only applies if you develop mfeflow itself. On 0.8.0 the warning was E117, "a copied file changed since mfeflow wrote it", for `pnpm-workspace.yaml`. The doctor prints the fix under it, and it only asks you to look.

The budget check needs a build first. Build, then measure:

```bash
pnpm build
pnpm mfeflow budget
```

You should see the JavaScript size of the shell and each remote:

```text
Initial JS, gzip (1 KB = 1024 bytes):
  shell shell: 99.5 KB in 2 scripts, no baseline set (budget.baselineKb), not checked
  remote catalog: entry 7.1 KB, limit 10
    /catalog (./App): 7.5 KB, no budget
  remote cart: entry 7.1 KB, limit 10
    /cart (./App): 7.5 KB, no budget
  remote reviews: entry 7.1 KB, limit 10
    /reviews (./App): 7.5 KB, no budget
LCP (+300 ms) is measured by the perf job, not here.
```

The numbers above came from the project in this tutorial, with reviews and event-bus added. Yours may differ slightly. [CI and budgets](/guide/ci-and-budgets) explains what the limits mean.

## Where the code lives

Everything is in the folder you created:

```text
demo/
  apps/shell/      the shell: routes, header, one file per remote in src/remotes/
  apps/catalog/    a remote. src/exposed/App.tsx is what the shell loads
  apps/cart/       the same, on port 4312
  apps/reviews/    the remote you just added, on port 4313
  registry/        one JSON file per remote and environment (dev, staging, prod)
  mfeflow.json     the apps, their ports and the features that are on
```

To change what a remote shows, edit `apps/<name>/src/exposed/App.tsx`. [Project structure](/guide/project-structure) lists every generated file.

## Start with only a shell

You do not have to start with remotes. If one team starts alone and others join later, create the shell by itself:

```bash
mfeflow init my-app --remotes none
```

`--remotes ""` means the same. Without the flag, `init` still makes `catalog` and `cart`. You get the shell and the checks, and the output says so:

```text
Created /work/my-app with only a shell.
Next:
  cd my-app
  pnpm install
  pnpm dev
Add a remote later with `mfeflow add remote <name>`.
```

`pnpm dev` starts the shell on port 4300. The page shows one line, "No remotes yet. Run `pnpm mfeflow add remote <name>`.", and the console stays clean. `mfeflow dev` prints the same hint once before it starts the shell:

```text
mfeflow: this project has no remotes yet. Add one with `mfeflow add remote <name>`.
shell: pnpm run dev in apps/shell (port 4300)
dev registry: []
```

When a team is ready, run `mfeflow add remote cart` and restart `pnpm dev`; the shell lists the remote and routes to it. With `--topology polyrepo` you get the `platform` and `shell` repos only, and the shell's dev config has an empty `devRemotes` until you run `mfeflow add team-repo <name>`. `none` cannot be mixed with names: `--remotes none,cart` is an error (E107).

## A repo with no apps

For shared config that other repos depend on, make a repo with no shell and no remotes:

```bash
mfeflow init acme-tooling --kind tooling --scope @acme --features lint-oxlint,git-hooks,commit-prompt
```

```text
Created /work/acme-tooling, a repo for shared tooling with no apps.
Next:
  cd acme-tooling
  pnpm install
  pnpm build
```

You get `@acme/contracts`, `@acme/tokens`, `@acme/tsconfig` and `@acme/oxlint-config`, a Renovate preset other repos can extend, a CI workflow, Changesets for versions, and the features you picked. `--packages` adds more packages in your scope, such as `analytics`, `theme` and `http`. Commands that are about apps print one line and succeed:

```text
$ mfeflow dev
This project has no apps, so there is nothing to run.
```

The packages, how an app repo uses them (a micro-frontend needs one more dependency), and what is not supported yet are in [A repo for shared tooling](/guide/tooling-repo).

## What you built

You have a pnpm monorepo with a shell, three remotes, a dev registry and a set of checks. Each remote can be built and deployed on its own.

## Next steps

- Read every generated file: [Project structure](/guide/project-structure).
- Add a remote with your own name and owner: [Add a remote](/guide/adding-a-remote).
- Understand the boot sequence: [How it works](/guide/how-it-works).
- Something failed: [Troubleshooting](/guide/troubleshooting).
