---
title: Bring an existing Module Federation app
description: How to run mfeflow adopt in a project you already have, what it reads, the files it writes, what it never touches, the list of settings it does not carry over, and what to do next.
---

# Bring an existing Module Federation app

This how-to sets up mfeflow in a project that already uses Module Federation. You keep your build config as it is. mfeflow adds the project file, an ownership file for each app and a registry entry for each remote.

## Before you start

You need a project with a Module Federation host (a shell) built with Rsbuild, Rspack or webpack. A workspace with several apps works too. Commit your work first, so you can review the result.

The folder must not have an `mfeflow.json`. If it does, `adopt` stops with [E123](/errors/E123).

## 1. Preview the change

Ask `adopt` what it would write. A dry run changes nothing:

```bash
pnpm dlx mfeflow adopt --dry-run
```

You should see the list of files, then the diff of each:

```text
10 to create, 1 to patch, 0 to delete
  create  apps/catalog/mfeflow.app.json
  create  apps/checkout/mfeflow.app.json
  create  apps/shell/mfeflow.app.json
  patch   apps/shell/package.json
  create  registry/envs/dev/catalog.json
  ...
  create  mfeflow.json
Dependencies (1):
  apps/shell/package.json  @mfeflow/runtime@^0.5.0
```

Below the diffs, `adopt` lists what it did not carry over and ends with "Dry run: nothing was written."

## 2. Read the not-carried-over list

Some settings have no place in mfeflow's files. Others it could not read safely. Each one is listed with the file, the setting and the reason:

```text
not carried over:
  apps/checkout/webpack.config.cjs filename: is set in the config but adopt does not carry it over
```

Nothing is guessed. If a value comes from a function call or an environment variable, it is listed here and left out. Your build config still holds the real value.

## 3. Write the files

Run the command without `--dry-run`. In a terminal it asks once before it writes:

```bash
pnpm dlx mfeflow adopt
```

Without a terminal, such as in a script, pass `--yes`. Without it the command exits with code 2 and writes nothing. This includes `--json`, which never prompts, so a real run with `--json` needs `--yes` too. The files are written all or nothing, and the install runs in the same step.

You should see the same summary, then the next steps.

## 4. Fill in the gaps

`adopt` cannot know who owns an app or which paths it serves. It writes `"owner": "unassigned"` and an empty `routes` list in every `mfeflow.app.json`. Set both, then check the result:

```bash
pnpm mfeflow validate
```

You should see every check marked `ok` and `0 error(s)` at the end.

## What it reads

`adopt` reads your build config as source text. It never imports or runs it. It looks at:

- `rsbuild.config.*` with `pluginModuleFederation`
- `module-federation.config.*` with `createModuleFederationConfig`
- `rspack.config.*` and `webpack.config.*` with `ModuleFederationPlugin`

For each app it takes the name, whether it is a shell or a remote, the dev port, the remotes it loads, the modules it exposes and the shared packages. In a pnpm or npm workspace it checks every package.

## What it writes

| File                                | Holds                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `mfeflow.json`                      | The apps, the topology (always `monorepo`) and the npm scope                          |
| `mfeflow.app.json` in each app      | The name, a placeholder owner, the shells that load it, its exposes and shared ranges |
| `registry/envs/<env>/<remote>.json` | A dev, staging and prod entry for each remote                                         |
| the shell's `package.json`          | `@mfeflow/runtime` added as a dependency                                              |

The dev entry points at the remote's local port. The staging and prod entries use `example.com` addresses. Set the real ones before you deploy.

A shared package's `requiredVersion` becomes a `platform` range in the app file. This is what `mfeflow check-compat` reads.

## What it never touches

`adopt` never edits a build config file. That covers every `rsbuild.config`, `rspack.config`, `webpack.config` and `module-federation.config` file. The output says so and prints the one line to paste yourself.

To share the runtime as a singleton, add this to the `shared` list in your shell's config:

```ts
'@mfeflow/runtime': { singleton: true },
```

An existing `mfeflow.app.json` or `mfe.json` is also kept as it is.

## Limits in this release

- A folder with only remotes and no shell stops with [E124](/errors/E124). Run `adopt` where the shell is. Single-remote repositories are planned with the multi-repo setup.
- An app needs a literal Module Federation `name` made of lowercase letters, digits and single underscores. Others are left out and listed.
- Remotes that your shell loads from another repository get no app entry and no registry entry. The output names them.
- Only pnpm and npm projects are supported.

## Next steps

- Try it first on the [adopt-existing example](https://github.com/mfeflow/mfeflow/tree/main/examples/adopt-existing), a plain app with one Rsbuild shell and two remotes.
- Read how [the shell loads remotes](/guide/how-it-works) through the registry.
- Learn the fields of the [app file](/reference/mfeflow-app-json) and the [project file](/reference/mfeflow-json).
- Deploy a remote with [Deploy and roll back](/guide/deploy-and-rollback).
- See every flag in the [CLI reference](/reference/cli#adopt).
