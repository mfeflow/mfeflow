# @mfeflow/registry

## 0.5.0

### Minor Changes

- [#42](https://github.com/mfeflow/mfeflow/pull/42) [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New package `@mfeflow/registry`: the core of a static remote registry. `@mfeflow/registry/static` builds the next `index.json` from a remote's build output and gates it (schema, route overlap, shared-range compatibility with the shell, size budget, and no rollout on a static host), keeps `previous` and the last 10 versions per remote for rollback, and plans the uploads with the right cache headers. Hosts are a local folder and any S3-compatible bucket (`@mfeflow/registry/s3`: AWS S3, Cloudflare R2, MinIO) with SigV4 written on `node:crypto` and no SDK; the index is written with `If-Match`.
  
  `@mfeflow/contracts` registry index remotes gain `previous`, `history` and `rolledBackFrom`, validation issues can carry a `code` (`ROUTE_OVERLAP`), `isPortableRelativePath` rejects names that are not valid on every OS, and it exports `remoteDistFiles`, `judgeRemoteInitial` and `primaryExpose`, the size logic `mfeflow budget` and the registry now share. `mfeflow` uses them and the registry's semver helpers; its behaviour is unchanged.

### Patch Changes

- Updated dependencies [[`fe74360`](https://github.com/mfeflow/mfeflow/commit/fe74360bdec93b458bc6211aeb5b1c7cf06a43e0), [`3c5bb1c`](https://github.com/mfeflow/mfeflow/commit/3c5bb1c7c329dad7e68832a2acfde1171786bc43), [`e2b7c0d`](https://github.com/mfeflow/mfeflow/commit/e2b7c0d0ce2de97936e0385e28d68ebf882eb67e), [`8c7570f`](https://github.com/mfeflow/mfeflow/commit/8c7570fdbeadac7b5a18f5fb6b1e8b8f0721ab83), [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215)]:
  - @mfeflow/contracts@0.5.0
