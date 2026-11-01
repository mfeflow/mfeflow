---
title: Versions and upgrades
description: How mfeflow versions its packages together before 1.0, what counts as a breaking change, how changesets record them, and how to update a project today without an upgrade command.
---

# Versions and upgrades

This page explains how mfeflow numbers its releases and how to move a project to a new one. There is no `upgrade` command in this release. You update by hand, and this page shows how.

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

- CLI commands, flags, exit codes and `--json` output shapes
- Error codes and what they mean
- The `mfeflow.json`, `mfe.json` and registry index schemas
- The `feature.json` format and the transform operations
- Each package's `exports`
- The layout of a generated project

Generated file contents that mfeflow does not migrate are not public API. They can change in a patch.

## How do I update a project?

Do these steps for each release. Read the changelog first, because a minor release before 1.0 can break things.

1. Read the changelog for every version between yours and the new one.
2. Change the `mfeflow` and `@mfeflow/*` ranges in each `package.json` to the new version.
3. Install and rebuild.

The ranges are carets on a 0.x version, so `^0.4.0` accepts 0.4.x only. Move all of them to the same new version:

```bash
pnpm install
pnpm build
```

Then run the checks to find drift between the apps:

```bash
pnpm mfeflow doctor
```

You should see `0 error(s)` at the end. Fix what the doctor reports before you merge.

## What about files the generator wrote?

New releases can change what `create-mfeflow` writes. Your project does not change on its own. Compare a fresh project from the new version with yours when the changelog says a generated file changed.

`mfeflow.json` records a hash for each file that was copied. When you edit one, `doctor` shows a warning (E117). Nothing is wrong. The hash is there so a later upgrade command can tell your edits from untouched files.

## Is there an upgrade command?

Not yet. A `mfeflow upgrade` command, with a diff before it touches anything, is planned for a later phase. The documentation will describe it when it exists.

## How are releases made?

This part is for contributors. Every change to a published package needs a changeset, a small file that records the bump and the note for people upgrading:

```bash
pnpm changeset
```

When changes reach `main`, a bot opens or updates a "version packages" pull request. Merging it is the release decision. Publishing uses npm trusted publishing with provenance and no stored token. The full flow is in `docs/versioning.md` in the repository.

Pre-releases use the `next` npm tag, for example `npm i mfeflow@next`.
