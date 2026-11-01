# Releasing

Each remote has its own version, kept by [Changesets](https://github.com/changesets/changesets). `mfeflow deploy`
publishes the version in the remote's `package.json`, so the version you release and the version you deploy are the
same number.

1. In a pull request that changes a remote, run `pnpm changeset`. Pick the remote, pick patch, minor or major, and
   write one plain sentence about the change. Commit the file it creates in `.changeset/`.
2. When you are ready to release, run `pnpm release:version`. It bumps `package.json` and `CHANGELOG.md` in each remote
   that has a changeset, and deletes the used notes. Commit the result and merge it.
3. Deploy: `pnpm mfeflow deploy <remote> --env prod`. With the `registry-static` feature that is
   `pnpm registry:deploy <remote> --env prod`, or the deploy workflow on `main`.

The remotes are private packages, so `.changeset/config.json` sets `privatePackages.version` to `true` (they get a
version) and `tag` to `false` (nothing is published to npm or tagged).

The files of a published version never change: deploying the same number with different content is refused. To ship
a fix, add a changeset and bump.

To go back to the previous version, run `mfeflow rollback <remote> --env prod`. It does not touch the version in
`package.json`, so after a rollback ship the fix as a new patch.
