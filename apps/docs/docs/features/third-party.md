---
title: Third-party features - Install or publish features from any registry
description: Install features other people publish from a static registry, or host your own, knowing they only list files and edits and never run code on your machine.
---

# Third-party features

Anyone can publish features for mfeflow, and you can install them from any registry you trust. A third-party feature is a `feature.json` on a static site, so there is no server to run and nothing that executes on your machine.

## What you get

A registry is a folder of static files. You add it under a namespace like `@acme`, and its features install the same way as the built-in ones.

A third-party feature is declarative. It lists files, dependencies, script names and edits made by a fixed set of built-in operations. It never runs code: not at install, not in a hook, not in a migration. `pnpm mfeflow add` shows the plan and the diff before it writes anything, and without a terminal it needs `--yes` to apply a registry feature at all.

## Add it

Register the site once, then install from it:

```sh
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
pnpm mfeflow add @acme/segment
```

This command lists the registry's features next to the first-party ones:

```sh
pnpm mfeflow features
```

What changes in your project is whatever the feature's `feature.json` declares. Your `mfeflow.json` also gets a `registries` entry.

## Use it

### Manage registries

```sh
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
pnpm mfeflow registry list
pnpm mfeflow registry remove @acme
```

`registry add` takes `--dry-run` and `--json`. To find a feature, search by name, description or keyword:

```sh
pnpm mfeflow features [search]
```

It reads every registry's index at the same time, so one slow registry does not delay the rest. It lists source, name, version and description.

A registry that cannot be read is reported with `MFEFLOW_E401`, or `E403` for a bad index. The rest are still listed and the command exits 0.

With `--json`, each feature has a source, and every registry gets one status:

```text
features[].source   # which registry a feature came from
registries          # one status per registry
```

### Write a feature

One folder per feature, each with a `feature.json`:

```
my-registry/
  segment/feature.json
  consent-banner/feature.json
```

```json title="my-registry/segment/feature.json"
{
  "$schema": "https://mfeflow.github.io/mfeflow/schema/feature.json",
  "name": "@acme/segment",
  "version": "1.2.0",
  "description": "Segment analytics behind the analytics provider interface",
  "keywords": ["analytics", "segment"],
  "requires": ["analytics-gtm"],
  "files": [
    {
      "to": "src/analytics/segment.ts",
      "target": "shell",
      "content": "export const SEGMENT = true;\n"
    }
  ],
  "dependencies": [{ "name": "@segment/analytics-next", "range": "^1.80.0", "target": "shell" }],
  "scripts": [
    { "name": "segment:check", "command": "node scripts/segment-check.js", "target": "shell" }
  ],
  "transforms": [
    {
      "op": "add-boot-step",
      "file": "src/bootstrap.tsx",
      "target": "shell",
      "call": "initSegment",
      "from": "./analytics/segment"
    }
  ]
}
```

A third-party feature may use only these top-level fields:

```text
name  version  description  keywords  prompts  requires
conflicts  files  dependencies  scripts  transforms
```

Anything else, such as migrations, hooks or unknown keys, is refused with `MFEFLOW_E203`.

A `target` is the shell, all remotes, or one app's name:

```text
shell  remotes  <app-name>
```

### Publish a registry

`registry build` checks every `feature.json` the way `add @namespace/name` will, then writes the files to host:

```sh
pnpm mfeflow registry build ./my-registry --out ./site
```

```
Built 1 feature(s) for @acme:
  @acme/segment 1.2.0

Wrote 4 files to /home/you/my-registry/site
```

| File                    | What it is                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| `index.json`            | The index `mfeflow features` reads.                                         |
| `<name>.json`           | The feature, for a template like `https://host/{name}.json`.                |
| `<name>/<version>.json` | The same feature at this version, for `https://host/{name}/{version}.json`. |
| `<name>/latest.json`    | What `{version}` becomes when the user did not ask for one.                 |

These flags change the build:

| Flag        | What it does                           |
| ----------- | -------------------------------------- |
| `--out`     | Output folder, `<dir>/dist` by default |
| `--dry-run` | Lists what would be written            |
| `--json`    | Prints the result as JSON              |

The build writes nothing when any feature fails, and it reports every failure in one go:

```
MFEFLOW_E404 A feature in the registry folder cannot be published: 2 problem(s)
  - one/feature.json: A third-party feature uses something third-party features may not: ".npmrc" is outside src/, public/ and docs/, where third-party features may write
  - two/feature.json: A third-party feature uses something third-party features may not: script "install" would run on its own (npm lifecycle)
```

It also needs one namespace per registry, one folder per feature name, a semver `version`, a `description`, and no feature called `index`.

### Host it on GitHub Pages

1. Put the features in a repository, one folder each.
2. Build into a folder Pages serves, here `docs/`.
3. Commit it, then publish Pages from the `main` branch and the `/docs` folder in the repository settings.
4. Users add your registry with its URL.

The commands for steps 2 and 4:

```sh
pnpm mfeflow registry build ./features --out ./docs
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
```

Any static host works the same way: S3, R2, Netlify or your own nginx. A GitHub Action that runs `registry build` and deploys the output keeps it fresh on every push.

### Try it before it is hosted

```sh
pnpm mfeflow registry build ./my-registry --out ./site
pnpm dlx serve ./site -l 4010                       # or any static server
pnpm mfeflow registry add @acme http://127.0.0.1:4010/{name}.json
pnpm mfeflow add @acme/segment
```

Switch the registry to its https URL before you commit `mfeflow.json`: run `registry remove`, then `registry add`.

## Configure it

### Registry rules

| Rule                   | Detail                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespace              | `@` and lower-case letters, digits and `-`. `@mfeflow` is reserved for the features that ship with mfeflow.                                                                                        |
| URL template           | Must contain `{name}`, the feature's name without the namespace. `{version}` is optional (`latest` when none was asked for). No other placeholders, none in the host, no user name or password.    |
| `https`                | Always. The one exception is plain `http` on this machine: `127.0.0.1`, `localhost` and `[::1]` only, so you can try a registry before it is hosted. Any other `http` URL is refused.              |
| Redirects              | Followed by hand. A redirect may not leave https; a loopback registry may not redirect to another plain-http host; an https registry may not redirect to a loopback address.                       |
| One namespace, one URL | `registry add` refuses to change a namespace that is set. Run `registry remove` first.                                                                                                             |
| In use                 | `registry remove` refuses while a feature installed from that namespace is in the project: `mfeflow add remote` and `add shell` fetch installed registry features again and would fail without it. |

### Trust a registry

Anyone who clones your repo also gets the registries listed in `mfeflow.json`. So mfeflow asks nothing of a registry until you trust it on your own machine.

Adding a registry trusts it, because you typed the address:

```sh
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
```

A registry that only came in with a cloned repo shows as "not trusted yet". Check its address, then trust it:

```sh
pnpm mfeflow registry list
pnpm mfeflow registry trust @acme
```

Trust covers the namespace and its exact URL. If someone changes the URL in `mfeflow.json`, you are asked again. `mfeflow registry untrust @acme` takes it back.

| Situation                                              | What happens                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| CI run                                                 | Set `MFEFLOW_TRUST_REGISTRIES=@acme` for that run. It reaches public addresses only.     |
| Registry on `localhost` or a private network           | Needs trust on your machine, or `@acme=<exact url>` in the CI variable.                  |
| A public registry redirects to a private address       | Always refused.                                                                          |
| `mfeflow add @acme/segment` on a public https registry | Allowed without trust: you named the feature, and nothing is written before you confirm. |

mfeflow records a hash of each registry feature when you add it. If the registry later serves different content, `add remote` and `add shell` stop with `MFEFLOW_E406`. Read what changed, then run again with `--accept-changed-content`.

Packages a registry feature adds are listed under **NEW PACKAGES** in the plan. Look at each one: npm and yarn run install scripts, pnpm 10 and later blocks them until you allow them.

Tokens in a registry URL are shown as `***` in output, but they stay in `mfeflow.json` as written. Keep secrets out of files you commit.

### The index

`index.json` sits in the folder the URL template starts in, before the first path segment with a placeholder:

| Template                                 | Index                                  |
| ---------------------------------------- | -------------------------------------- |
| `https://acme.dev/features/{name}.json`  | `https://acme.dev/features/index.json` |
| `https://acme.dev/{version}/{name}.json` | `https://acme.dev/index.json`          |
| `https://acme.dev/api?feature={name}`    | `https://acme.dev/index.json`          |

```json title="index.json"
{
  "$schema": "https://mfeflow.github.io/mfeflow/schema/feature-registry-index.json",
  "items": [
    {
      "name": "segment",
      "version": "1.2.0",
      "description": "Segment analytics behind the analytics provider interface",
      "keywords": ["analytics", "segment"]
    }
  ]
}
```

The `name` has no namespace, because the registry's namespace goes in front: `@acme/segment`. Descriptions are plain text of at most 300 characters, with at most 20 keywords of 40 characters, at most 1000 items, and a file of at most 1 MB. Control characters are refused, so an index cannot write escape sequences to your terminal. The schema is at [`/schema/feature-registry-index.json`](https://mfeflow.github.io/mfeflow/schema/feature-registry-index.json).

### What a feature may contain

| Part         | Allowed                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name         | `@namespace/name`, never `@mfeflow`. The name in the file must be the name the user asks for.                                                                                                                                                                                                                                                                                                                                        |
| Files        | Inline `content` only (no `from`, no `atRoot`). Only under `src/`, `public/` and `docs/` of the target app. Names are lower-case ASCII (letters, digits, `.`, `_`, `-`). No package-manager or git-hook files, no test, spec or config files (`a.test.ts`, `vite.config.ts`, a `tests/` folder), no `features/` folder, no symlinked path.                                                                                           |
| Dependencies | A registry version, range or dist-tag. Never `file:`, `link:`, `workspace:`, `catalog:`, a git or URL spec, a tarball or an `npm:` alias. An existing dependency's range is never changed silently (`MFEFLOW_E207`).                                                                                                                                                                                                                 |
| Scripts      | Lower-case, starting with the feature's own name: `segment` or `segment:part` for `@acme/segment`, so `build`, `lint:*` and similar runners never pick them up. Never a lifecycle name (`install`, `prepare`, `test`, `start`...), never `pre` or `post` something, never a `pnpm:`, `npm:`, `yarn:` or `bun:` prefix. They are added to `package.json` and shown; mfeflow never runs them. An existing script is never overwritten. |
| Transforms   | `add-import`, `wrap-provider`, `add-shared`, `add-boot-step`, `add-env-key` and `add-route`, on files the path rules above allow. `add-workflow-step` is first-party only: a third-party feature cannot edit CI. Module specifiers must be a package name, a relative path or an `@/` alias, never a URL.                                                                                                                            |
| Env schemas  | `add-env-key` `schema` must be a call chain on `z`, `v` or `type` with literal arguments (`z.string().url()`). It is parsed and written back from the syntax tree, so nothing else can ride along.                                                                                                                                                                                                                                   |
| Size         | The file at most 1 MB.                                                                                                                                                                                                                                                                                                                                                                                                               |

## How it works

A feature that breaks a rule fails with `MFEFLOW_E203` and a message naming the file or field and the rule. Nothing is written. A transform operation that does not exist is `MFEFLOW_E204`. If you need an operation that is not in the list, open an issue: the operations are a public API, not an escape hatch.

### Versions

Versions are semver, and your `mfeflow.json` records the version that was installed. Build into the same folder, or keep it under version control, and each release adds one file.

| File                    | Behaviour                         |
| ----------------------- | --------------------------------- |
| `<name>.json`           | Always the current version        |
| `<name>/latest.json`    | Always the current version        |
| `<name>/<version>.json` | Stays as published, never changes |

Adding a remote or shell later applies the installed registry features to the new app again, at the recorded version. If the registry now serves another version and your template has no `{version}`, `add` stops with `MFEFLOW_E401` before writing anything.

A template with a version placeholder keeps working across releases, which is why the build writes both forms:

```text
https://host/{name}/{version}.json
```

## Gotchas

:::warning
Do not delete old output from the folder you publish. A published `<name>/<version>.json` should never change, and users on that version need it. Publish a new version instead.
:::

- **Plain http is for this machine only.** Any other http address, such as a LAN IP or a lookalike host name, is refused.
- **A registry in use cannot be removed.** Features installed from it are fetched again when you add a remote or shell.
- **Review before you apply.** Read the plan and the diff `add` shows. Without a terminal, `--yes` skips that, so use it only for a registry you trust.

## Reference

- [Third-party features, the idea](/concepts/third-party-features)
- [feature.json](/reference/feature-json), the full manifest format
- [`mfeflow` CLI reference](/reference/cli)
- [Adding features](/guide/adding-features)
- [E203](/errors/E203), [E204](/errors/E204), [E207](/errors/E207), [E401](/errors/E401), [E403](/errors/E403) and [E404](/errors/E404)
