---
'mfeflow': minor
'@mfeflow/contracts': minor
'@mfeflow/core': minor
---

New commands `mfeflow deploy`, `promote`, `rollback` and `status` publish remotes to a static registry. `deploy` uploads a remote's build and points an environment at it, `promote` copies the pointer from one environment to another, `rollback` goes back to the previous version (or `--to`) without a rebuild, and `status` shows what each environment serves and any drift. Hosts are `file:<dir>` or `s3://<bucket>[/prefix]`, with S3 settings and credentials read from environment variables only. All four take `--json`, `--dry-run`, `--cwd` and `--yes`. Gate failures exit with 7 and the new `MFEFLOW_E501` to `E512` codes; exit code 7 is now the deploy range (it was reserved for upgrade), and the `EXIT.upgrade` key of the exported `EXIT` table is now `EXIT.deploy`; the number is unchanged.

`mfeflow.json` gains `registry.host` and `registry.baseUrl`, validated and in the published JSON schema. `@mfeflow/core` lists the new error codes.
