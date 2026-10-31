# Versioning and releases

mfeflow follows [semantic versioning](https://semver.org). Every public package (`mfeflow`,
`create-mfeflow` and each `@mfeflow/*`) is versioned together: one version number, one release,
one GitHub Release. They are the `fixed` group in `.changeset/config.json`, and `pnpm check:pack`
fails if a public package is missing from it. A package with no changes still gets the new version.

## Before 1.0 (0.x)

- A **minor** bump (0.2.0 to 0.3.0) can break the public API. The changeset says what broke and how
  to migrate.
- A **patch** bump (0.2.0 to 0.2.1) never breaks it: fixes, and features that add without changing
  what exists.

From 1.0 on, major is breaking, minor adds, patch fixes.

## What is public API

A change to any of these is a breaking change:

- CLI commands, flags and exit codes (`mfeflow init`, `add`, `doctor`, `--json` output shapes, ...).
- `MFEFLOW_E*` error codes: their meaning and exit codes. New codes are not breaking.
- The `mfeflow.json`, `mfe.json` and registry (`index.json`) schemas.
- `feature.json` and the names and options of the transform ops (`add-import`, `wrap-provider`, ...).
- Each package's `exports`: the subpaths and what they export.
- The layout of a generated project that `mfeflow upgrade` migrates.

Anything else (internal modules, generated file contents that are not migrated, log wording) can
change in a patch.

## Writing a changeset

Any change to a published package needs one:

```sh
pnpm changeset
```

Pick the packages and the bump (patch or minor before 1.0; use minor for a breaking change and start
the text with `Breaking (0.x):`), then describe the change for the person upgrading: what changed,
what to do. Commit the generated file in `.changeset/` with the pull request.

## Release flow

Releasing is `.github/workflows/release.yml`, off until the repository variable `RELEASE_ENABLED` is
`true`. Each step runs in its own job with only the access it needs.

1. **Version pull request.** On every push to `main`, the Changesets action opens or updates
   "chore: version packages": it bumps the versions, writes the changelogs (with pull request and
   author links, through `@changesets/changelog-github`) and removes the changesets. Pushes made with
   the workflow token do not start other workflows, so close and reopen that pull request if its
   checks do not appear.
2. **Merge it.** The merge is the release decision.
3. **Pack.** With no changesets pending and a version missing from npm, the `pack` job installs with
   `--ignore-scripts`, builds, runs `pnpm check:pack`, packs every public package with `pnpm pack`
   (which rewrites `workspace:` and `catalog:` specs) and uploads the tarballs with
   `release-manifest.json` (name, version, tarball, sha256). It holds no npm access.
4. **Publish.** The `publish` job runs in the GitHub Environment `npm`, so a required reviewer can
   gate it. It installs only Node 24 (npm at least 11.5.1, checked), verifies every sha256 and the
   prerelease policy, and runs `npm publish --provenance --access public --ignore-scripts` per tarball:
   `@mfeflow/contracts`, `@mfeflow/core`, the other packages after their dependencies, then `mfeflow`
   and `create-mfeflow`. A version already on npm is skipped, so re-running a failed job is safe.
5. **Tag and release.** The `tag` job creates `<name>@<version>` for every package and `v<version>`,
   and one GitHub Release `v<version>` with the notes from `packages/cli/CHANGELOG.md` and the tarballs
   attached.

The `publish-check` job in `ci.yml` runs the same pack and a `npm publish --dry-run` with a throwaway
version (`0.0.0-ci.<run id>`, not committed) on every pull request.

### One-time setup (repository owner)

1. Settings, Secrets and variables, Variables: add `RELEASE_ENABLED` = `true` when ready to release.
2. Settings, Environments: create an environment named `npm`. Optionally add yourself as a required
   reviewer, so every publish waits for an approval.
3. Settings, Secrets and variables, Secrets: add `NPM_TOKEN`, an npm automation token that can publish
   `mfeflow`, `create-mfeflow` and `@mfeflow/*`. It is read by the publish step only.
4. After the first publish, on npmjs.com open each package, Settings, Trusted Publisher, and add
   GitHub Actions with repository `mfeflow/mfeflow`, workflow `release.yml` and environment `npm`.
5. Then delete the `NPM_TOKEN` secret and the `NODE_AUTH_TOKEN` line in the publish step. The job
   already has `id-token: write`, so publishing keeps working through OIDC.

## Pre-releases

Use Changesets pre mode and the `next` dist-tag:

```sh
pnpm changeset pre enter next
# merge version pull requests: 0.3.0-next.0, 0.3.0-next.1, ...
pnpm changeset pre exit
```

While pre mode is on, versions look like `0.3.0-next.1` and publish under the `next` tag, never
`latest`; the publish job refuses a prerelease on any other tag. Users opt in with
`npm i mfeflow@next`. After `pre exit`, the next version pull request is the stable release.

## Deprecation

After 1.0, something public is deprecated in one minor release (a warning, and the replacement in the
changeset) and removed no sooner than the next major. Before 1.0, a removal can ship in a minor, but
still gets a changeset with a `Breaking (0.x):` note and the migration.
