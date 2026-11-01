---
'@mfeflow/registry': minor
---

`@mfeflow/registry/server`: a self-hosted registry server on `node:http` and `node:sqlite` (Node 22.13 or newer; it stops with a clear message on an older Node). `GET /v1/index/:env` serves the same index the static path builds; `POST /v1/deploy`, `/v1/promote` and `/v1/rollback` run the same gates and history rules as the static path; `POST /v1/kill` removes a remote from the served index on the next request; `GET /v1/audit` lists who changed what. Bearer tokens are scoped by env, remote and action and stored as SHA-256 hashes; `mfeflow-registry token create` prints one once. After every change the server republishes a stable-only `index.json` through a host so shells can boot from it when the server is down. Storage sits behind an interface so Postgres can follow.
