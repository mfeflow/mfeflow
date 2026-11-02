# @mfeflow/registry

## 0.7.0

### Patch Changes

- [#71](https://github.com/mfeflow/mfeflow/pull/71) [`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The registry server image on GHCR is now built for linux/amd64 and linux/arm64, so it runs natively on Apple Silicon and Graviton. The base image is pinned by its multi-arch digest.
- Updated dependencies [[`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72)]:
  - @mfeflow/contracts@0.7.0

## 0.6.0

### Minor Changes

- [#62](https://github.com/mfeflow/mfeflow/pull/62) [`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Each app now keeps its owner, routes and budgets in `mfeflow.app.json`, next to the project's `mfeflow.json`. The old name `mfe.json` still works: mfeflow reads it and prints one notice per command asking you to rename it. If an app has both files, mfeflow stops with the new error E122, because it cannot tell which one you meant.
  
  New projects and the templates use the new name. The schema is published at `/schema/mfeflow-app.json`, and the old `/schema/mfe.json` address keeps working, so existing `$schema` lines still resolve. `mfeflow upgrade` renames the file for you.

- [#57](https://github.com/mfeflow/mfeflow/pull/57) [`6808d78`](https://github.com/mfeflow/mfeflow/commit/6808d78a27fb348a00ab688b1ddaa4c237ff6e9a) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `@mfeflow/registry/server`: a self-hosted registry server on `node:http` and `node:sqlite` (Node 22.13 or newer; it stops with a clear message on an older Node). `GET /v1/index/:env` serves the same index the static path builds; `POST /v1/deploy`, `/v1/promote` and `/v1/rollback` run the same gates and history rules as the static path; `POST /v1/kill` removes a remote from the served index on the next request; `GET /v1/audit` lists who changed what. Bearer tokens are scoped by env, remote and action and stored as SHA-256 hashes; `mfeflow-registry token create` prints one once. After every change the server republishes a stable-only `index.json` through a host so shells can boot from it when the server is down. Storage sits behind an interface so Postgres can follow.

- [#66](https://github.com/mfeflow/mfeflow/pull/66) [`dd290f1`](https://github.com/mfeflow/mfeflow/commit/dd290f11ebef6dc53bac930954cecab59ec148bf) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Run the registry server from the command line and from Docker. Set `MFEFLOW_REGISTRY_URL` (or pass `--registry-url`) and `mfeflow deploy`, `promote`, `rollback` and `status` talk to the server instead of writing a static index; without it nothing changes. New commands: `mfeflow rollout status|step|complete|abort`, `mfeflow kill` and `mfeflow restore`, and `--percent` with `--steps` on `deploy` and `promote` to start a percentage rollout. The token is read only from `MFEFLOW_REGISTRY_TOKEN`, never from a flag, and is scrubbed from every message and from `--json`. Plain http is refused unless the server is on localhost. Server answers map to the existing deploy error codes (E506 to E511) and exit 7.
  
  `@mfeflow/registry` stops gracefully: on SIGTERM the server lets running requests finish, then closes. The package ships a Dockerfile, a compose example with MinIO and an image on ghcr.io for each release. A new `registry-server` feature wires a project to a server, and there are guides for running it and for its response times.

- [#58](https://github.com/mfeflow/mfeflow/pull/58) [`315720e`](https://github.com/mfeflow/mfeflow/commit/315720e8c7688c64ac3d541cb9f6cf9df9fc801c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Two new features. `registry-static` adds `registry:deploy`, `registry:rollback` and `registry:status` scripts, a guide, and, when `ci-github` is present, a workflow that deploys every remote when `main` changes. Its `host` and `baseUrl` options are what `deploy`, `promote`, `rollback` and `status` use when `mfeflow.json` has no `registry` setting. `release` sets up Changesets so each remote gets its own version, and `deploy` publishes that version.
  
  The registry README no longer says nothing is wired to a command.

- [#63](https://github.com/mfeflow/mfeflow/pull/63) [`8169ac3`](https://github.com/mfeflow/mfeflow/commit/8169ac3a6b14fcc1b3327011dcdab3407aaf0afc) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Percentage rollouts on the registry server. A deploy can carry `rollout: { percent, steps }`: that share of clients (chosen by the `u` id on `GET /v1/index/:env`, always the same ones) gets the new version, and everyone else keeps stable. `POST /v1/rollout/step`, `/complete` and `/abort` move it along, under a new `rollout` token action, and every change is audited. `POST /v1/beacon` takes load and error counts from browsers, with strict validation and a per-address rate limit. A page sends one report with its browser id, and each browser counts once per rollout side, on the side it is assigned to, up to a cap per rollout. `GET /v1/rollout` shows each side's numbers and why the gate is waiting. After a minimum sample (200 candidate loads and 50 distinct browsers on each side by default) the server halts a candidate whose error rate is twice stable's and at least two points higher, and the audit entry gives the numbers. The static fallback index still holds stable only.
  
  `@mfeflow/runtime` gets an optional beacon, off by default. With `registryBeacon: true` in the runtime config, `registrySourcesWithBeacon()` from `@mfeflow/runtime/beacon` adds a browser id to the server index URL and reports the page's loads and errors in one request when the page is hidden. A shell that does not import it is unchanged in size.

### Patch Changes

- Updated dependencies [[`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651), [`2fc1be2`](https://github.com/mfeflow/mfeflow/commit/2fc1be21fd211e04e5301d04deb218832b0fbab5), [`e7a9ede`](https://github.com/mfeflow/mfeflow/commit/e7a9edeacac7ad3f55edc9abca14519a4ce15665)]:
  - @mfeflow/contracts@0.6.0

## 0.5.0

### Minor Changes

- [#42](https://github.com/mfeflow/mfeflow/pull/42) [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New package `@mfeflow/registry`: the core of a static remote registry. `@mfeflow/registry/static` builds the next `index.json` from a remote's build output and gates it (schema, route overlap, shared-range compatibility with the shell, size budget, and no rollout on a static host), keeps `previous` and the last 10 versions per remote for rollback, and plans the uploads with the right cache headers. Hosts are a local folder and any S3-compatible bucket (`@mfeflow/registry/s3`: AWS S3, Cloudflare R2, MinIO) with SigV4 written on `node:crypto` and no SDK; the index is written with `If-Match`.
  
  `@mfeflow/contracts` registry index remotes gain `previous`, `history` and `rolledBackFrom`, validation issues can carry a `code` (`ROUTE_OVERLAP`), `isPortableRelativePath` rejects names that are not valid on every OS, and it exports `remoteDistFiles`, `judgeRemoteInitial` and `primaryExpose`, the size logic `mfeflow budget` and the registry now share. `mfeflow` uses them and the registry's semver helpers; its behaviour is unchanged.

### Patch Changes

- Updated dependencies [[`fe74360`](https://github.com/mfeflow/mfeflow/commit/fe74360bdec93b458bc6211aeb5b1c7cf06a43e0), [`3c5bb1c`](https://github.com/mfeflow/mfeflow/commit/3c5bb1c7c329dad7e68832a2acfde1171786bc43), [`e2b7c0d`](https://github.com/mfeflow/mfeflow/commit/e2b7c0d0ce2de97936e0385e28d68ebf882eb67e), [`8c7570f`](https://github.com/mfeflow/mfeflow/commit/8c7570fdbeadac7b5a18f5fb6b1e8b8f0721ab83), [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215)]:
  - @mfeflow/contracts@0.5.0
