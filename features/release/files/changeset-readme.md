# Changesets

A changeset is a short note, in this folder, that says which remote changed and how big the change is. Add one with
`pnpm changeset` in every pull request that changes a remote. `pnpm release:version` turns the notes into version
bumps in each remote's `package.json` and into its `CHANGELOG.md`.

See `docs/releasing.md`.
