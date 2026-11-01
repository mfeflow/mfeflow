---
'@mfeflow/registry': minor
'@mfeflow/contracts': minor
'mfeflow': minor
---

New package `@mfeflow/registry`: the core of a static remote registry. `@mfeflow/registry/static` builds the next `index.json` from a remote's build output and gates it (schema, route overlap, shared-range compatibility with the shell, size budget, and no rollout on a static host), keeps `previous` and the last 10 versions per remote for rollback, and plans the uploads with the right cache headers. Hosts are a local folder and any S3-compatible bucket (`@mfeflow/registry/s3`: AWS S3, Cloudflare R2, MinIO) with SigV4 written on `node:crypto` and no SDK; the index is written with `If-Match`.

`@mfeflow/contracts` registry index remotes gain `previous` and `history`, and it exports `remoteDistFiles`, `judgeRemoteInitial` and `primaryExpose`, the size logic `mfeflow budget` and the registry now share. `mfeflow` uses them and the registry's semver helpers; its behaviour is unchanged.
