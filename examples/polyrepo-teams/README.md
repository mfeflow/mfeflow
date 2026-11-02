# One repo per team

An example for a company where each team owns its own repository. You generate the repos with mfeflow, run the shell next to remotes from other repos, add a team, publish the shared packages and set up CI across the repos.

There is no checked-in copy of the repos here. A polyrepo is a set of git repos, so a copy in this folder would be a fake. You generate the real thing in a few seconds. The [One repo per team guide](../../apps/docs/docs/guide/polyrepo.md) explains each step in more depth.

All the output below comes from a real run in a temp folder.

## Prerequisites

- Node 22.12 or newer
- pnpm 12.16.1
- git
- mfeflow 0.6.0 or newer, the first release with `--topology polyrepo`

The first install needs the network.

## 1. Create the repos

Make a folder outside any git repo, then run the creator. This writes four repos for the org `acme`:

```bash
pnpm create mfeflow acme --topology polyrepo --remotes catalog,cart --yes
```

You should see the last lines of the summary:

```text
Created /path/to/acme with 4 repos (platform, shell, catalog, cart), each with its own git repo.
CI calls acme/platform's reusable workflow; check the owner.
Next:
  cd acme
  pnpm -C platform build
  pnpm -C shell dev
  pnpm -C catalog dev   # in its own terminal
  pnpm -C cart dev   # in its own terminal
```

mfeflow runs `git init` in each folder and never calls GitHub. The CI owner defaults to the scope without the `@`. Pass `--org <github-owner>` if yours is different.

## 2. See what was generated

Here is the tree, trimmed to the files that matter. Each of the four folders is its own git repo with its own `mfeflow.json`:

```text
acme/
  platform/
    .changeset/config.json
    .github/workflows/
      ci.yml  reusable-ci.yml  release.yml
    default.json                    Renovate preset every repo extends
    packages/
      contracts/                    @acme/contracts
      tokens/                       @acme/tokens
    mfeflow.json
  shell/
    .github/workflows/ci.yml
    apps/shell/
      public/config/
        runtime-config.dev.json     the devRemotes live here
        runtime-config.staging.json
        runtime-config.prod.json
      src/remotes/                  one file per remote, plus the route table
    registry/envs/
      staging/{catalog,cart}.json
      prod/{catalog,cart}.json
    mfeflow.json
  catalog/
    .github/workflows/ci.yml        calls the platform's reusable workflow
    apps/catalog/
    mfeflow.json
  cart/                             same shape as catalog
```

Check one thing before you go on. The shell repo has no `registry/envs/dev` entries. In dev it reads `devRemotes` instead.

## 3. Run the shell with remotes from other repos

Build the platform packages first. The other repos link to their output:

```bash
pnpm -C platform build
```

You should see both packages compile:

```text
packages/contracts build$ tsc
packages/tokens build$ tsc
packages/tokens build: Done
packages/contracts build: Done
```

Start each remote in its own terminal, then the shell. The shell repo runs the shell only:

```bash
pnpm -C catalog dev
pnpm -C cart dev
pnpm -C shell mfeflow dev
```

You should see the shell start on port 4300:

```text
mfeflow: running shell. Ctrl+C stops everything.
shell | $ rsbuild dev
shell |   ➜  Local:    http://localhost:4300/
```

The shell finds the remotes in `devRemotes`, in `shell/apps/shell/public/config/runtime-config.dev.json`:

```json
{
  "environment": "dev",
  "devRemotes": {
    "catalog": "http://localhost:4311/mf-manifest.json",
    "cart": "http://localhost:4312/mf-manifest.json"
  }
}
```

Each remote repo serves on the port listed there. To point at a remote someone else runs, pass `--remote cart=http://localhost:3001`.

The repo's [smoke script](../../scripts/smoke-polyrepo.mjs) runs this whole flow on every pull request. It generates the repos, builds them, boots the shell next to a remote and adds a team repo while it runs. Run `node scripts/smoke-polyrepo.mjs` from a checkout to see it.

## 4. Add a team

A new team gets a new repo. Run this in the shell repo:

```bash
cd shell
pnpm mfeflow add team-repo checkout
```

You should see the new repo, then what changed in the shell:

```text
checkout/
19 to create, 0 to patch, 0 to delete
...
shell/
3 to create, 3 to patch, 0 to delete
  patch   apps/shell/public/config/runtime-config.dev.json
  create  apps/shell/src/remotes/checkout.tsx
  patch   apps/shell/src/remotes/route-table.tsx
  create  registry/envs/prod/checkout.json
  create  registry/envs/staging/checkout.json
  patch   mfeflow.json

Added checkout (team-repo) at /path/to/acme/checkout.
Next:
  cd ../checkout && pnpm install
  pnpm dev
```

`devRemotes` now lists the checkout on port 4313. If `mfeflow dev` is still running, the shell picks it up without a restart.

## 5. Publish the platform packages

Until you publish, the repos link to `../platform` on disk. That works on one machine. It breaks in CI, where the platform repo is not next to the others.

Create the five repos on GitHub and push each folder. Then pick a registry for `@acme/contracts` and `@acme/tokens`. The guide lists npm, GitHub Packages and a private registry. The release flow is the same for all three. Describe a change in the platform repo:

```bash
cd ../platform
pnpm changeset
```

Merge your pull request and set the repository variable `RELEASE_ENABLED` to `true`. The release workflow then opens a "chore: version packages" pull request. Merging it publishes.

After the first publish, replace the links in each repo:

```bash
cd ../shell/apps/shell
pnpm add @acme/contracts@^0.1.0 @acme/tokens@^0.1.0
```

You should see both packages change from `link:` paths to versions in `package.json`. Repeat in each remote.

## 6. Run CI across the repos

Every team repo has the same three-line workflow. It calls the platform's:

```yaml
jobs:
  ci:
    permissions:
      contents: read
    uses: acme/platform/.github/workflows/reusable-ci.yml@main
```

The platform workflow installs, then runs typecheck, lint and test when the repo defines them. It then builds and runs `mfeflow validate` and `mfeflow doctor`. Change the platform workflow once and every repo gets it. If the platform repo is private, allow the others to use it in its Actions settings.

A remote repo cannot see the shell, so `mfeflow doctor` there ends with this warning:

```text
warning MFEFLOW_E302 A remote is not compatible with its shell: shell is not in this repo, run `mfeflow check-compat --against <url|file>`
```

Point `check-compat` at the shell you deploy. This is the check that catches a remote built on React 19 when the shell serves React 18. A small file stands in for the shell's `mf-manifest.json`. It lists the React version the shell shares:

```json
{ "name": "shell", "shared": [{ "name": "react", "version": "19.3.1", "singleton": true }] }
```

Save it as `shell-manifest.json` in the org folder. Then run the check in a remote repo:

```bash
pnpm mfeflow check-compat --against ../shell-manifest.json
```

You should see the check pass when the versions agree:

```text
ok    each remote's shared ranges fit the shells it runs in
```

When they do not, it exits with code 5:

```text
FAIL  each remote's shared ranges fit the shells it runs in

error MFEFLOW_E302 A remote is not compatible with its shell: catalog uses react 19.3.1, the shell provides 18.3.1
```

In real CI, pass the https address of your deployed registry index instead of a file. The generated workflow does not run this step. Add it to the platform's `reusable-ci.yml` once you know that address. See [CI and budgets](../../apps/docs/docs/guide/ci-and-budgets.md).

## What you built

- A platform repo that publishes two packages, with a reusable CI workflow and a Renovate preset.
- A shell repo that finds its remotes through `devRemotes` in dev and a registry in staging and prod.
- A repo per team, and one command to add another.
- A cross-repo version check against the deployed shell.

## Not covered here

- A hybrid layout, a platform monorepo with team repos next to it, is not available yet.
- `mfeflow upgrade` does not work inside a polyrepo yet. Update each repo by hand.
- The `ci-github` and `env-t3` features cannot be added to a polyrepo yet.
