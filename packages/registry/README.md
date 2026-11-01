# @mfeflow/registry

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

A registry for your remotes that lives on a static host. You build the next `index.json` from a remote's build output, check it against a few gates, and upload it. A rollback is the same upload with the previous version, no rebuild. Pre-1.0: minor versions may change the API.

```sh
pnpm add @mfeflow/registry
```

The static path is a library the `mfeflow` deploy and rollback commands sit on. The server is below.

## Build and gate an index

`@mfeflow/registry/static` has no IO in the builder, so it is easy to test and to run in CI.

```ts
import { localHost, planDeploy, applyPlan, readIndex } from '@mfeflow/registry/static';

const host = localHost('./site');
const { index, etag } = await readIndex(host, 'prod');

const plan = planDeploy({
  remote: mfeJson, // the remote's mfe.json
  version: '1.4.2+a1b2c3d',
  manifest: mfManifest, // its built mf-manifest.json
  files, // build output: path -> bytes
  env: 'prod',
  baseUrl: 'https://cdn.example.com',
  currentIndex: index,
  currentIndexEtag: etag,
  shellManifest, // the shell's deployed mf-manifest.json, optional
});

if (plan.failures.length > 0) throw new Error(plan.failures.map((f) => f.message).join('\n'));
await applyPlan(host, plan);
```

A deploy that fails a gate uploads nothing. The gates, by code:

| Code            | Fails when                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `schema`        | the entry, the remote or the whole index is not valid, or `mf-manifest.json` is for another remote                |
| `route-overlap` | one of the remote's routes can match a URL that another remote's route matches                                    |
| `compat`        | a singleton range the remote asks for is not satisfied by the version the shell provides                          |
| `budget`        | the initial JS (gzip) is over `mfe.json` `budgets.initialJsKb`, or, without one, the entry is over the cost model |
| `rollout`       | a `rollout` is asked for; a static host cannot split traffic by percent                                           |

Shell versions come from the shell's `mf-manifest.json` `shared` entries, then from `workspaceVersions` for anything it does not list.

Each remote keeps `previous` and the last 10 versions in `history` (newest first), so a rollback knows where to go.

**Rollback.** Deploying a version that is already in `history` is a rollback. The remote then records the version it left in `rolledBackFrom`, and `previous` and `history` hold only versions older than the one you went back to. Rolling back again goes to the next older version and never returns to the bad one. Deploying a new version clears `rolledBackFrom`, and the version you rolled back from is forgotten: after v1, v2, v3, a rollback to v2 and a deploy of v4, the history is v2, v1 and v3 is gone from the index.

Warnings (`plan.warnings`) are checks that could not run, for example a shell version of `workspace:*` or a package the shell manifest lists with no version. They do not fail the deploy.

## What gets uploaded

- `<name>/<version>/...` with `Cache-Control: public, max-age=31536000, immutable`. A `+` in a version becomes `_` in keys and URLs.
- `envs/<env>/index.json` with `public, max-age=60` (set `indexCacheControl` to change it). That number is how long a rollback takes to reach users.
- Artifacts first, the index last. A file already published with the same size is skipped; one with a different size stops the deploy, because a version is immutable.

## Hosts

A host is `{ put, get, head, list? }`. The index is written with `If-Match` (or `If-None-Match: *` for the first one in an env), so two deploys cannot overwrite each other; the loser gets a `PreconditionFailedError` and reads the index again. `planDeploy` needs `currentIndexEtag` whenever you pass `currentIndex`. Artifacts are written create-only with their SHA-256 stored alongside, so a version can never be replaced with different content.

**A folder.** `localHost(dir)` writes files (to a temp file, then a rename, so a crash never leaves half a file) and refuses any key that leaves `dir`: `..`, absolute paths, drive letters, backslashes, `:` in a name, Windows device names, and symlinks that point outside. An index update takes a `.lock` file next to the index; one left behind by a crash is cleared after 30 seconds, and a fresh one that does not go away within 2 seconds fails with its path.

**S3-compatible storage.** AWS S3, Cloudflare R2 and MinIO, signed with SigV4 on `node:crypto` and the global `fetch`. No SDK.

```ts
import { s3Host } from '@mfeflow/registry/s3';

const host = s3Host({
  endpoint: 'https://<account>.r2.cloudflarestorage.com', // omit for AWS
  region: 'auto',
  bucket: 'my-registry',
  accessKeyId: process.env.S3_KEY_ID,
  secretAccessKey: process.env.S3_SECRET,
});
```

A custom `endpoint` uses path-style URLs (`https://host/bucket/key`); set `forcePathStyle` to change either way. Errors never contain the keys or the session token.

The least a deploy needs on the bucket (scope `Resource` to the prefix you use):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-registry/*"
    },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::my-registry" }
  ]
}
```

Without `s3:ListBucket`, S3 answers 403 instead of 404 for a key that does not exist. The host does not guess: it throws an `AccessDeniedError` that names the missing permission.

**GitHub Pages.** Not an adapter. Deploy into a folder with `localHost` and let a Pages workflow publish the folder. Pages caches every file for 10 minutes and you cannot change that, so a rollback there takes about 11 minutes. Use a bucket if that is too slow.

## The server

`@mfeflow/registry/server` is the same registry as a small HTTP service, for when a static index is not enough: scoped tokens, an audit log and a kill switch that works on the next request. It uses `node:http` and `node:sqlite`, so there is no framework and no database to run. The package's `engines` is `>=22.13` for that reason (this also covers the `/static` and `/s3` subpaths, which would run on 22.12 but share the package). On an older Node the server stops at start with a message saying so, because `node:sqlite` sits behind a flag before that. Node prints an "experimental" warning for SQLite; that is expected.

```sh
pnpm add @mfeflow/registry
export MFEFLOW_REGISTRY_ARTIFACT_BASE_URL=https://cdn.example.com
export MFEFLOW_REGISTRY_FALLBACK_HOST=s3://my-registry   # or file:./site
pnpm exec mfeflow-registry token create --env prod --remote '*' --actions deploy,rollback   # prints the token once
pnpm exec mfeflow-registry serve
```

Settings are environment variables, checked at start (all problems are listed together):

| Variable                             | Default                 | Meaning                                                                 |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------- |
| `MFEFLOW_REGISTRY_PORT`              | `8787`                  | Port.                                                                   |
| `MFEFLOW_REGISTRY_BIND`              | `127.0.0.1`             | Address to bind. Put TLS in front of it.                                |
| `MFEFLOW_REGISTRY_DB`                | `./mfeflow-registry.db` | SQLite file.                                                            |
| `MFEFLOW_REGISTRY_ARTIFACT_BASE_URL` | unset                   | Where artifacts are served from. `deploy` is off without it.            |
| `MFEFLOW_REGISTRY_FALLBACK_HOST`     | unset                   | `file:<dir>` or `s3://<bucket>[/prefix]` for the static fallback index. |
| `MFEFLOW_REGISTRY_CORS_ORIGINS`      | none                    | Comma-separated origins that may read the index from a browser.         |
| `MFEFLOW_REGISTRY_MAX_BODY_BYTES`    | `262144`                | Largest request body.                                                   |

S3 credentials for the fallback host come from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MFEFLOW_S3_REGION` (or `AWS_REGION`) and optionally `MFEFLOW_S3_ENDPOINT`, as in the CLI.

**Endpoints.** JSON in, JSON out. Upload the build to the artifact host first; the server never stores files.

| Endpoint                  | Needs                                         | What it does                                                                                                                                               |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/index/:env?u=id` | nothing                                       | The index for the env, the same shape as the static one.                                                                                                   |
| `POST /v1/deploy`         | `deploy`                                      | Registers an uploaded version and serves it, after the schema, overlap, compat and budget gates.                                                           |
| `POST /v1/promote`        | `promote` on the target, `read` on the source | Points `to` at the version `from` serves.                                                                                                                  |
| `POST /v1/rollback`       | `rollback`                                    | Back to `previous`, or to `to` from the history. `force` skips the gates, not the history check.                                                           |
| `POST /v1/kill`           | `kill`                                        | Removes the remote from the served index now. `restore: true` puts it back.                                                                                |
| `GET /v1/audit?env=`      | `read`                                        | Who did what, when, and the versions before and after. Entries carry token ids and kill reasons (free text from the caller), so treat the log as internal. |
| `GET /healthz`            | nothing                                       | Checks the database.                                                                                                                                       |

A deploy sends `env`, `remote`, `version`, `owner`, `routes` and `manifestUrl`, which must be `<base>/<name>/<version>/mf-manifest.json` under the artifact base URL (`+` in a version is `_`). Optional: `platform` and `budgets.initialJsKb`, as in `mfe.json`. The server reads the manifest and the first-load files from the artifact host to measure and check them. A version is immutable: registering the same version with a different manifest is refused. A killed remote cannot be deployed, promoted or rolled back until it is restored.

**Caching.** The index is `Cache-Control: private, max-age=5`. A CDN or shared proxy must not cache it: the next release of this server picks the response per client (`u`), and a shared cache would hand one client's answer to another. Browsers keep it for 5 seconds. The static fallback index is separate, and public for 60 seconds.

**Tokens.** `mfr_<id>.<secret>`, sent as `Authorization: Bearer`. Each is scoped to an env (or `*`), a remote (or `*`) and actions: `read`, `deploy`, `promote`, `rollback`, `kill`, `admin` (all of them). Only the SHA-256 hash is stored, compared in constant time. `token list` shows ids and scopes, `token revoke <id>` ends one. Reading the index needs no token.

**Fallback.** After every change the server rewrites `envs/<env>/index.json` on the fallback host with the stable pointers only (killed remotes left out), so shells that fall back to it still boot with the server down. A failed write is logged and retried with backoff; it never delays or fails the request. Every env is republished at start.

**Concurrent writers.** An env has a revision. A deploy, promote or rollback that read an older one gets `409 conflict` and should read again and retry, the same idea as the static `If-Match`. A kill retries by itself, because it has to land.

**Security.** The database file is created with mode 0600. Versions must be plain semver (`1.4.2`, `1.4.2-rc.1`, `1.4.2+sha`), file names from a manifest must be plain relative paths, and every artifact URL is rebuilt and checked to stay under the artifact base URL. A deploy reads at most 32 MiB from the artifact host in total, streamed with a running cap. Errors from the artifact host go to the server log, not the response. Bodies are capped and must be `application/json`. There are no CORS headers unless you list origins, and then only on the index endpoint. The server reads only URLs under the artifact base URL, with no redirects. Tokens, secrets and authorization headers are never logged. Rate limiting is not built in: put the server behind a proxy that limits requests.

A promote needs a token that covers both envs (`env` `*`, or `admin`), since it reads one and writes the other.

Not here yet: percentage rollout and telemetry gating (next), `mfeflow` CLI server mode and a Docker image (after that), Postgres.

MIT licensed.
