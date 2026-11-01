---
title: One repo per team
description: Tutorial for a polyrepo. Create a platform repo, a shell repo and a repo for each remote with init --topology polyrepo, run them together, add a team repo, and publish the shared packages.
---

# One repo per team

This tutorial creates a polyrepo: a platform repo, a shell repo and one repo for each remote. You run the shell next to a remote from another repo, then add a team repo. At the end you know the steps that only you can do: GitHub and a package registry.

mfeflow writes the repos on your machine. It never calls GitHub. For why you might want this layout, read the [FAQ](/guide/faq#can-i-use-separate-repositories-for-each-remote).

## Before you start

You need Node.js 22.12 or newer, pnpm 12.16.1, git and mfeflow 0.6.0 or newer. The first install needs the network.

Check your versions:

```bash
node --version
pnpm --version
git --version
```

You should see something like this:

```text
v22.23.4
12.16.1
git version 2.50.1
```

## 1. Create the repos

Run the creator with the topology and the remotes:

```bash
pnpm create mfeflow acme --topology polyrepo --remotes catalog,cart --yes
```

It writes four folders, runs `git init` in each and installs each one. The last lines are:

```text
Created /path/to/acme with 4 repos (platform, shell, catalog, cart), each with its own git repo.
Next:
  cd acme
  pnpm -C platform build
  pnpm -C shell dev
  pnpm -C catalog dev   # in its own terminal
  pnpm -C cart dev   # in its own terminal
```

This is what each folder holds:

```text
acme/
  platform/   shared packages, reusable CI, Renovate preset, Changesets
  shell/      the shell app, the registry, the dev config
  catalog/    the catalog remote
  cart/       the cart remote
```

Every folder is its own git repo with its own `mfeflow.json`. Go into the org folder:

```bash
cd acme
```

## 2. Build the platform packages

The platform repo publishes two packages: `@acme/contracts` and `@acme/tokens`. The shell and the remotes read them through `link:` paths, so build them first:

```bash
pnpm -C platform build
```

You should see both packages build:

```text
packages/contracts build$ tsc
packages/tokens build$ tsc
packages/tokens build: Done
packages/contracts build: Done
```

Check that the output exists:

```bash
ls platform/packages/contracts/dist
```

You should see the compiled files:

```text
index.d.ts
index.js
```

The shell's `package.json` points at them with `link:../../../platform/packages/contracts`. These two packages need no registry, which is why it is the default. [Publish the packages](#6-publish-the-platform-packages) replaces it later.

## 3. Run the shell and the remotes

Start a remote in its own terminal. This one is the catalog:

```bash
pnpm -C catalog dev
```

Start the cart the same way in a third terminal. Then start the shell in the first terminal:

```bash
pnpm -C shell mfeflow dev
```

You should see the shell start:

```text
mfeflow: running shell. Ctrl+C stops everything.
shell | $ rsbuild dev
shell | Rsbuild v2.3.0
shell |   ➜  Local:    http://localhost:4300/
```

Open `http://localhost:4300`. You should see a header with home, catalog and cart. The home page shows both remotes.

The shell does not read a registry folder in dev. It reads `devRemotes` in `shell/apps/shell/public/config/runtime-config.dev.json`:

```json
{
  "environment": "dev",
  "devRemotes": {
    "catalog": "http://localhost:4311/mf-manifest.json",
    "cart": "http://localhost:4312/mf-manifest.json"
  }
}
```

Each remote repo serves on the port in that file. To use a remote you run somewhere else, add `--remote` to the command:

```bash
pnpm -C shell mfeflow dev --remote cart=http://localhost:3001
```

The first line says which remote is yours:

```text
mfeflow: running shell; using your cart. Ctrl+C stops everything.
```

See [Develop locally](/guide/development) for the other flags.

## 4. Add a team repo

A new team gets a new repo. Run this in the shell repo:

```bash
cd shell
pnpm mfeflow add team-repo checkout
```

It creates `../checkout` as a git repo and registers the remote in the shell. The last lines are:

```text
shell/
3 to create, 3 to patch, 0 to delete

Added checkout (team-repo) at /path/to/acme/checkout.
Next:
  cd ../checkout
  pnpm dev
```

The shell got a route, staging and prod registry entries and a dev server entry on port 4313. If `mfeflow dev` is still running, the shell lists the new remote without a restart.

Preview the change first with `--dry-run`. Nothing is written in either repo:

```bash
pnpm mfeflow add team-repo checkout --dry-run
```

You should see `Dry run: nothing was written.`

Check the shell repo:

```bash
pnpm mfeflow validate
```

You should see no errors:

```text
0 error(s), 0 warning(s), 0 skipped
```

## 5. Put the repos on GitHub

This step is yours. For each folder, create an empty repo with the same name in your GitHub organization. Then push from that folder:

```bash
cd ../platform
git add -A
git commit -m "feat: first version"
git branch -M main
git remote add origin git@github.com:acme/platform.git
git push -u origin main
```

You should see a line like this from git:

```text
branch 'main' set up to track 'origin/main'.
```

Repeat for `shell`, `catalog`, `cart` and `checkout`. The CI and Renovate files point at `<owner>/platform`. The owner defaults to the scope without the `@`, here `acme`. If your GitHub owner is different, create the repos with `--org <github-owner>`, and `init` prints which owner the CI calls. `add team-repo` reuses the same owner.

Each team repo calls the reusable workflow in `platform/.github/workflows/reusable-ci.yml`. If the platform repo is private, allow the others to use it under Settings, Actions, General, Access.

## 6. Publish the platform packages

Until the packages are on a registry, only machines that have the folders side by side can install the other repos. CI cannot, because `../platform` is not there. Pick one registry:

| Option           | Setup                                                                     | Good for                     |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------- |
| `link:` paths    | None. The default                                                         | Trying it out on one machine |
| npm              | Set the `NPM_TOKEN` secret in the platform repo                           | Public packages              |
| GitHub Packages  | Add `@acme:registry=https://npm.pkg.github.com` to `.npmrc` in every repo | Private packages in one org  |
| Private registry | Put its URL in `.npmrc` and in `publishConfig.registry` of each package   | Your own infrastructure      |

Whichever you choose, the release flow in the platform repo is the same. Describe a change with a changeset:

```bash
cd ../platform
pnpm changeset
```

Commit the changeset and merge your pull request. Set the repository variable `RELEASE_ENABLED` to `true`. The release workflow then opens a "chore: version packages" pull request, and merging it publishes.

After the first publish, replace the links in each repo. This example is for the shell:

```bash
cd ../shell/apps/shell
pnpm add @acme/contracts@^0.1.0 @acme/tokens@^0.1.0
```

You should see both packages move from `link:` to a version in `package.json`. Do the same in each remote.

## What you built

- A platform repo that publishes `@acme/contracts` and `@acme/tokens` with Changesets.
- A reusable CI workflow and a Renovate preset that every repo uses.
- A shell repo that finds its remotes through a dev config, and a registry for staging and prod.
- A repo for each remote, and a command to add one more.

Every `mfeflow.json` has `topology` set to `polyrepo` and a `repo` of `platform`, `shell` or `remote`. See [mfeflow.json](/reference/mfeflow-json).

## Troubleshoot

`add team-repo works in the shell repo of a polyrepo` (E107). You ran the command in another repo, or in a monorepo. Go to the `shell` folder and run it again.

`/path/to/acme/checkout already has notes.txt` (E108). The folder next to the shell is not empty. Pick another name or move the folder.

`--features ci-github: not in a polyrepo yet, every repo already calls the reusable workflow in the platform repo` (E107). Leave the feature out. `env-t3` is refused too, because it writes the runtime config files that hold the dev config.

`upgrade does not work in the repos of a polyrepo yet` (E107). Update the `mfeflow` packages in each repo by hand for now.

`pnpm install` fails in a team repo on CI. The `link:` paths need `platform` next to the repo. [Publish the packages](#6-publish-the-platform-packages) and replace the links.

## Next

- [Deploy and roll back](/guide/deploy-and-rollback) a remote from its own repo.
- [CLI reference](/reference/cli) for every flag of `init` and `add`.
