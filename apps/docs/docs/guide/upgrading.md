---
title: Versions and upgrades
description: How mfeflow versions its packages together before 1.0, what counts as a breaking change, how changesets record them, and a tutorial for moving a project to a new version with mfeflow upgrade.
---

# Versions and upgrades

This page explains how mfeflow numbers its releases and how to move a project to a new one with the `upgrade` command.

## How are versions numbered?

mfeflow follows semantic versioning. Every public package moves together: `mfeflow`, `create-mfeflow` and each `@mfeflow/*` package share one version number. A package with no changes still gets the new number.

Releases are listed in each package's `CHANGELOG.md`. The `mfeflow` package changelog is the best one to read.

## What can break before 1.0?

While the version starts with 0, the rules are shifted by one place.

| Bump  | Example        | May break the public API?                       |
| ----- | -------------- | ----------------------------------------------- |
| Minor | 0.4.0 to 0.5.0 | Yes. The changelog says what and how to migrate |
| Patch | 0.4.0 to 0.4.1 | No. Fixes and additions only                    |

From 1.0, a major release is breaking, a minor adds features, and a patch fixes bugs.

## What counts as public API?

A change to any of these is a breaking change:

- CLI commands, flags, exit codes and JSON output shapes
- Error codes and what they mean
- The schemas of the project file, the app file and the registry index
- The feature file format and the transform operations
- Each package's exports
- The layout of a generated project

Generated file contents that mfeflow does not migrate are not public API. They can change in a patch.

## How do I upgrade a project?

This tutorial moves a project made with an older mfeflow to the version you run. The command never overwrites a file you changed unless you say so. It does not ask npm for a newer version. It upgrades to the version that runs, so `pnpm dlx mfeflow@latest upgrade` is the whole command.

You need a project with an `mfeflow.json` and a clean working tree, so you can review the result.

1. Read the changelog for every version between yours and the new one. A minor release before 1.0 can break things.

2. See what would change. A dry run prints a summary and every diff, and writes nothing:

   ```bash
   pnpm dlx mfeflow@latest upgrade --dry-run
   ```

   You should see the summary first:

   ```text
   Upgrading 0.1.0 to 0.5.0 (0.1.0 read from package.json)

   Replaced, you had not changed them (20):
     .github/workflows/ci.yml
     .gitignore
     ...
   Created (1):
     apps/shell/src/assert.ts
   Edited in place:
     package.json: 3 @mfeflow ranges moved to ^0.5.0; scripts added: doctor, validate, check-compat, budget
     pnpm-workspace.yaml: catalog entries and build rules added
   Files you changed (1):
     apps/shell/src/pages/Home.tsx  you edited it; needs a decision
   ```

   The diffs follow. The last group is the one to read.

3. Decide about each file you changed. Take the new version with `--accept`, or keep yours with `--keep`. Both take a path, a comma list, or `all`:

   ```bash
   pnpm dlx mfeflow@latest upgrade --keep apps/shell/src/pages/Home.tsx
   ```

   In a terminal it asks once before it writes. You should see:

   ```text
   Upgraded to 0.5.0.
   ```

4. Run it again to check. A kept file stays quiet until the new version of that file changes:

   ```bash
   pnpm dlx mfeflow@latest upgrade
   ```

   You should see:

   ```text
   /work/shopco is already at 0.5.0; nothing to write.
   ```

5. Run the checks to find drift between the apps:

   ```bash
   pnpm mfeflow doctor
   ```

   You should see `0 error(s)` at the end.

## What happens when I skip step 3?

In CI or a script there is nobody to ask. A file you changed and did not decide on stops the run before anything is written:

```bash
pnpm dlx mfeflow@latest upgrade --yes
```

You should see an error, and the exit code is 8:

```text
MFEFLOW_E604 Files you changed need a decision: 1 not decided: apps/shell/src/pages/Home.tsx
```

Add `--accept` or `--keep` and run it again. `--yes` does not skip this: it only stops the questions. A `--dry-run` never fails this way, and exits 0 even when files wait for a decision. The [error page](/errors/E604) has the details.

## What does the upgrade touch?

- A generated file you did not edit is replaced. A new file is created.
- `package.json`, `pnpm-workspace.yaml` and `turbo.json` only get small edits. The `@mfeflow/*` ranges move, and new scripts, dependencies and tasks are added.
- Files the new version no longer makes, and files you deleted, are listed. They are never deleted and never brought back.
- A file that `add env-key` added keys to is replaced only if every key in it is still in the new version. Otherwise it is listed with your keys. Accepting it drops them, so add them back with `mfeflow add env-key`.
- If you edited such a file, a key whose value differs from the new version counts as lost too. `mfeflow add env-key` records each key it adds in `envKeys` in `mfeflow.json`. When the new version changes the value of a recorded key, the file is listed as changed by the CLI and needs a decision: `--accept` takes the new value and `--keep` keeps yours. If the project has no record of the key (it was made before `envKeys` existed), an untouched file still takes the new value and the plan prints a warning naming the keys, because mfeflow cannot tell a value you set with `add env-key` from one the template changed. When an env file is held back for a missing key, the changed values are listed with it.
- A symlink is reported and never written over, even with `--accept all`. It needs no decision and never blocks a run.
- A file inside a symlinked folder counts the same way. If `apps/shell/src` points somewhere else, nothing under it is written, because the write would land outside the place the plan shows. The check runs again when the files are written, for every file including `package.json`, so a link added after the plan was made is caught and the run stops with E105 before anything is written.
- A file you edited is offered only when the new version generates something different from the old one.
- A feature from a registry is applied only after you confirm, or with `--yes` when there is no terminal. If the registry now serves other bytes for the same version, the run stops with E406 until you pass `--accept-changed-content`.
- A registry feature with no hash in `mfeflow.json` cannot be checked. The plan lists it as first seen, and the hash the registry serves now is recorded, so the next run can check it.
- Files are written all or nothing, and the install runs in the same step. If it fails, every file is put back.

`mfeflow.json` records a hash for each copied file, and a `kept` entry for each file you kept. The flags are in the [CLI reference](/reference/cli#upgrade).

## What if a registry feature changed?

If the registry serves other bytes for a feature at the version you installed, the upgrade stops with E406. Look at what changed before you go on. Then take the new content for the feature you trust:

```bash
pnpm dlx mfeflow@latest upgrade --accept-changed-content @acme/hello
```

You should see the upgrade run, and `mfeflow.json` now holds the new hash. Without a name the flag takes every changed feature, so name the ones you checked. A feature you did not name still stops the run. The new hash is saved even when the files themselves did not change, so the next run does not stop again.

## How are releases made?

This part is for contributors. Every change to a published package needs a changeset, a small file that records the bump and the note for people upgrading:

```bash
pnpm changeset
```

When changes reach `main`, a bot opens or updates a "version packages" pull request. Merging it is the release decision. Publishing uses npm trusted publishing with provenance and no stored token. The full flow is in `docs/versioning.md` in the repository.

Pre-releases use the `next` npm tag, for example `npm i mfeflow@next`.
