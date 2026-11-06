---
title: Join an existing platform with a remote
description: Make a repo of remotes with no shell, for a team whose platform already has a deployed shell. Covers init --kind remote and running against the deployed shell.
---

# Join an existing platform with a remote

Your platform already has a shell, and another team owns it. You own one or more remotes. `mfeflow init --kind remote` makes a repo with those remotes and no shell.

Before this, the only way to get such a repo was `mfeflow add team-repo`, run in the shell's repo of a polyrepo. That needs access to the shell's repo. This does not.

## The `repo` field

`mfeflow.json` has a `repo` field that says what kind of repo it is. Absent, it is an app repo with a shell. `platform` is a repo of shared tooling. `remote` is a repo whose shell lives somewhere else, and it is the only kind that may have no shell in `apps`. The field does not say how many repos there are: a remotes-only repo made here has `topology: "monorepo"`, because everything in it is in one workspace.

## Create it

```bash
mfeflow init parts --kind remote --scope @acme --remotes cart,checkout \
  --shell https://app.example.com/mf-manifest.json
```

The last lines of the output:

```text
Created /work/parts with 2 remotes (cart, checkout) and no shell.
Next:
  cd parts
  pnpm install
  pnpm dev
The shell is deployed from another repo; its routes and registry entries are added there.
```

`--remotes` needs at least one name. Without the flag you get one remote called `catalog`. `--remotes none` is an error, because a repo with no shell and no remotes has nothing in it. `pnpm create mfeflow` takes the same flags.

`--shell` is optional. It is where the deployed shell is: an https URL of its `mf-manifest.json` or of a registry index, or a file. It is the same thing `--against` takes. A file is recorded relative to the project. A URL with credentials or a token in it is refused, because `mfeflow.json` is committed. `init` does not fetch the address; `doctor` does.

## What you get

```text
apps/cart         a remote exposing ./App, on port 4311
apps/checkout     a remote exposing ./App, on port 4312
mfeflow.json      repo: "remote", shell: the address you gave
package.json      the workspace root, with the doctor, validate, check-compat and budget scripts
```

There is no `apps/shell` and no `registry/` folder. Which build of a remote each environment serves is recorded in the shell's repo, and so are the routes to it.

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` all run. `pnpm dev` serves both remotes, and each one's `mf-manifest.json` answers on its port:

```text
http://localhost:4311/mf-manifest.json -> cart http://localhost:4311/ [ 'App' ]
http://localhost:4312/mf-manifest.json -> checkout http://localhost:4312/ [ 'App' ]
```

Features work as in any project. A feature that also changes the shell (`theming`, `i18n`, `analytics-gtm`, `telemetry-otel`, `tailwind` and others) writes its remote parts here and does not write the shell parts, so add it in the shell's repo too. This release does not list what was skipped.

## Check it against the shell

Without a shell address, `doctor` says what it cannot do:

```text
warning MFEFLOW_E302 A remote is not compatible with its shell: shell is not in this repo, run `mfeflow doctor --against <url|file>`
```

With `--shell` at `init` (or a `shell` field you add to `mfeflow.json`), `doctor` and `check-compat` read the deployed shell's shared versions from that address and the warning goes away:

```text
ok    each remote's shared ranges fit the shells it runs in
...
0 error(s), 0 warning(s), 1 skipped
```

The skipped check is the registry one: the registry is in the shell's repo. `--against` on the command line wins over the recorded address. A react version in your remotes that the shell does not provide is an error (E302), as in any project. See [check-compat](/reference/cli#check-compat).

## See a remote in the deployed shell

`pnpm mfeflow dev` runs the remotes, and with a recorded shell it prints how to see one there:

```text
mfeflow: the shell is at https://app.example.com/mf-manifest.json. To see cart there, add ?mfe-override=cart@http://localhost:4311/mf-manifest.json to a page of that shell. This works only if that shell is a development build; production builds ignore overrides.
```

That limit is real. A shell built for production ignores `mfe-override`, so against a production shell this does not work. Ask the shell's owners for a development or preview build, or run a copy of the shell on your machine with `mfeflow dev --remote cart=http://localhost:4311` (see [Develop locally](/guide/development)). We ran it once: a shell from a normal project, started with `mfeflow dev --only shell --remote cart=http://localhost:4311 --remote checkout=http://localhost:4312`, rendered both remotes of a repo made this way, checked with the Playwright smoke test the project ships.

## Add a remote, deploy, upgrade

`mfeflow add remote orders` adds the app and nothing else. It writes no route and no registry entry, because both are in the shell's repo; ask the shell's owners to add them, or use `mfeflow deploy` if you publish your own registry.

`mfeflow deploy` works. If the host has no `shell/mf-manifest.json`, they warn `no shell manifest at envs/staging/shell/mf-manifest.json; compat used workspace versions` and carry on.

`mfeflow upgrade --dry-run` works and does not bring back a shell or a registry folder.

## What it does not do

- It does not deploy or roll back a shell you do not own.
- `mfeflow adopt` refuses a project with only remotes (E124).
- It does not check the shell's routes. Whether the shell sends `/cart` to your remote is the shell's repo to say.

For a polyrepo where the same company owns every repo, see [One repo per team](/guide/polyrepo).
