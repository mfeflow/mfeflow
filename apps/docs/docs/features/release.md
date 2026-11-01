# release

Version each remote with Changesets, and deploy that same version. Opt-in: `pnpm mfeflow add release`.

## What you get

- Changesets, configured for private packages: each remote gets its own version and changelog.
- Scripts `changeset` and `release:version`.
- `.changeset/config.json` and `docs/releasing.md` in your project.

## When to use it

Use it when several teams ship their own remotes and each needs a version number that means something.

## Add it

Run this in your project:

```sh
pnpm mfeflow add release
```

You should see `.changeset/config.json` in the list of changes.

## Use it

In a pull request that changes the `catalog` remote, add a note:

```sh
pnpm changeset
```

You pick the remote, the size of the change and write a sentence. It creates a file in `.changeset/`.

When you release, turn the notes into versions:

```sh
pnpm release:version
```

You should see the version in `apps/catalog/package.json` go up. Deploy that version:

```sh
pnpm mfeflow deploy catalog --env prod
```

`deploy` reads the version from `package.json`, so the number you released is the number you deploy.

## How it works

The config sets `privatePackages.version` to `true` and `tag` to `false`. Remotes are private, so they get a version and a changelog, but nothing is tagged or published to npm.

## Gotchas

- The files of a version never change. Deploying the same number with different files is refused, so bump first.
- A rollback does not change `package.json`. After one, ship the fix as a new patch.
