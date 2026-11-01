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

`@mfeflow/registry/server` is the same registry as a small HTTP service, for when a static index is not enough: scoped tokens, an audit log and a kill switch that works on the next request. It uses `node:http` and `node:sqlite`, so there is no framework and no database to run. **The server needs Node 22.13 or newer** (the rest of the package still runs on 22.12, so `engines` stays `>=22.12`). On an older Node the server stops at start with a message saying so, because `node:sqlite` sits behind a flag before that. Node prints an "experimental" warning for SQLite; that is expected.

```sh
pnpm add @mfeflow/registry
export MFEFLOW_REGISTRY_ARTIFACT_BASE_URL=https://cdn.example.com
export MFEFLOW_REGISTRY_FALLBACK_HOST=s3://my-registry   # or file:./site
pnpm exec mfeflow-registry token create --env prod --remote '*' --actions deploy,rollback   # prints the token once
pnpm exec mfeflow-registry serve
```

Settings are environment variables, checked at start (all problems are listed together):

| Variable                                 | Default                 | Meaning                                                                             |
| ---------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `MFEFLOW_REGISTRY_PORT`                  | `8787`                  | Port.                                                                               |
| `MFEFLOW_REGISTRY_BIND`                  | `127.0.0.1`             | Address to bind. Put TLS in front of it.                                            |
| `MFEFLOW_REGISTRY_DB`                    | `./mfeflow-registry.db` | SQLite file.                                                                        |
| `MFEFLOW_REGISTRY_ARTIFACT_BASE_URL`     | unset                   | Where artifacts are served from. `deploy` is off without it.                        |
| `MFEFLOW_REGISTRY_FALLBACK_HOST`         | unset                   | `file:<dir>` or `s3://<bucket>[/prefix]` for the static fallback index.             |
| `MFEFLOW_REGISTRY_CORS_ORIGINS`          | none                    | Comma-separated origins that may read the index from a browser.                     |
| `MFEFLOW_REGISTRY_MAX_BODY_BYTES`        | `262144`                | Largest request body.                                                               |
| `MFEFLOW_REGISTRY_GATE_MIN_LOADS`        | `200`                   | Candidate loads before the gate judges a rollout.                                   |
| `MFEFLOW_REGISTRY_GATE_MIN_CLIENTS`      | `50`                    | Distinct browsers needed on each side before the gate judges.                       |
| `MFEFLOW_REGISTRY_ROLLOUT_MAX_REPORTERS` | `20000`                 | Browsers counted per rollout. Past it new ones are dropped.                         |
| `MFEFLOW_REGISTRY_GATE_FACTOR`           | `2`                     | Halt when the candidate's error rate is over stable's times this.                   |
| `MFEFLOW_REGISTRY_GATE_FLOOR`            | `0.02`                  | ...and over stable's by at least this much (0.02 is two points).                    |
| `MFEFLOW_REGISTRY_BEACON_BURST`          | `60`                    | Beacons one client address can send at once.                                        |
| `MFEFLOW_REGISTRY_BEACON_PER_MINUTE`     | `60`                    | How fast that allowance refills.                                                    |
| `MFEFLOW_REGISTRY_TRUST_PROXY`           | unset                   | `true` reads the client address from `X-Forwarded-For`. Only behind your own proxy. |

S3 credentials for the fallback host come from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MFEFLOW_S3_REGION` (or `AWS_REGION`) and optionally `MFEFLOW_S3_ENDPOINT`, as in the CLI.

**Endpoints.** JSON in, JSON out. Upload the build to the artifact host first; the server never stores files.

| Endpoint                       | Needs                                         | What it does                                                                                                                                               |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/index/:env?u=id`      | nothing                                       | The index for the env, the same shape as the static one. With `u`, the version that client should load.                                                    |
| `POST /v1/deploy`              | `deploy`                                      | Registers an uploaded version and serves it, after the schema, overlap, compat and budget gates.                                                           |
| `POST /v1/promote`             | `promote` on the target, `read` on the source | Points `to` at the version `from` serves.                                                                                                                  |
| `POST /v1/rollback`            | `rollback`                                    | Back to `previous`, or to `to` from the history. `force` skips the gates, not the history check.                                                           |
| `POST /v1/rollout/step`        | `rollout`                                     | Moves a running rollout to its next percent.                                                                                                               |
| `POST /v1/rollout/complete`    | `rollout`                                     | Makes the candidate the stable version for everyone.                                                                                                       |
| `POST /v1/rollout/abort`       | `rollout`                                     | Ends the rollout; everyone gets stable again.                                                                                                              |
| `GET /v1/rollout?env=&remote=` | `read`                                        | A running rollout's percent, the clients, loads and errors on each side, and why the gate is waiting.                                                      |
| `POST /v1/beacon`              | nothing                                       | Browsers report load and error counts. Validated and rate limited.                                                                                         |
| `POST /v1/kill`                | `kill`                                        | Removes the remote from the served index now. `restore: true` puts it back.                                                                                |
| `GET /v1/audit?env=`           | `read`                                        | Who did what, when, and the versions before and after. Entries carry token ids and kill reasons (free text from the caller), so treat the log as internal. |
| `GET /healthz`                 | nothing                                       | Checks the database.                                                                                                                                       |

A deploy sends `env`, `remote`, `version`, `owner`, `routes` and `manifestUrl`, which must be `<base>/<name>/<version>/mf-manifest.json` under the artifact base URL (`+` in a version is `_`). Optional: `platform` and `budgets.initialJsKb`, as in `mfe.json`. The server reads the manifest and the first-load files from the artifact host to measure and check them. A version is immutable: registering the same version with a different manifest is refused. A killed remote cannot be deployed, promoted or rolled back until it is restored.

### Percentage rollouts

A deploy can serve the new version to a share of clients first. Everyone else keeps getting the stable version.

Send a `rollout` with the deploy:

```json
{
  "env": "prod",
  "remote": "cart",
  "version": "2.0.0",
  "owner": "team-cart",
  "routes": ["/cart"],
  "manifestUrl": "https://cdn.example.com/...",
  "rollout": { "percent": 10, "steps": [50, 100] }
}
```

You should see `"rollout": { "stable": "1.0.0", "candidate": "2.0.0", "percent": 10, "steps": [50, 100] }` in the answer. The stable version is still what the env points at. `percent` is 1 to 99, and `steps` must rise. The remote must already have a stable version.

A client lands in the candidate group when `hash(u, remote, rolloutId) % 100` is under the percent. The same `u` always gets the same side, and raising the percent only adds clients. A request without `u` gets stable. The id is random per rollout, so the next rollout picks different clients first.

While a rollout runs, deploy, promote and rollback for that remote answer `409 rollout_active`. A kill still works. Then move it along, each call with `env` and `remote`:

- `POST /v1/rollout/step` goes to the next percent. With none left it answers `409 no_next_step`.
- `POST /v1/rollout/complete` makes the candidate the stable version, with the old one as `previous`. If another remote has since taken one of its routes, it answers `409 route_overlap` and the rollout keeps running.
- `POST /v1/rollout/abort` goes back to stable. An optional `reason` is audited.

Each call is in the audit log as `rollout.step`, `rollout.complete` or `rollout.abort`. The static fallback index never holds the candidate. A static host still refuses a rollout (E505).

**Gating.** Shells report how their remotes did. The server judges a candidate only when it has at least `MFEFLOW_REGISTRY_GATE_MIN_LOADS` loads and both the candidate and stable have at least `MFEFLOW_REGISTRY_GATE_MIN_CLIENTS` distinct browsers. Then it compares error rates. It halts the rollout when the candidate is more than `MFEFLOW_REGISTRY_GATE_FACTOR` times worse and at least `MFEFLOW_REGISTRY_GATE_FLOOR` worse in absolute terms. Halting is an abort, and the audit entry `rollout.halt` has the reason and both sets of counts. The floor keeps a stable with almost no errors from making ordinary noise look like a regression.

**Watch the gate.** The gate also waits for `MFEFLOW_REGISTRY_GATE_MIN_CLIENTS` on the stable side. At a high percent, or with little traffic, stable may never reach that many, and then the gate never fires. `GET /v1/rollout?env=prod&remote=cart` shows what it sees. You should see `gate.verdict` as `wait`, with a reason such as `2 of 50 stable clients so far`, next to `candidateCounts` and `stableCounts`. If you roll out slowly on a quiet remote, lower the minimums or watch your own error tracking.

Counts are kept per rollout, so they start at zero and stop when it ends. Reports for anything that is not the candidate or stable of a running rollout are dropped.

**The beacon.** `POST /v1/beacon` needs no token, because it comes from browsers. One request is one page: `{ "env", "u", "entries": [{ "remote", "version", "loads", "errors" }] }`, with 1 to 20 entries. It is sent as `application/json` or `text/plain` (what `navigator.sendBeacon` sends). `u` is the same id the page sent on the index request. Each entry has `loads` 0 or 1 and `errors` no more than `loads`. Unknown fields are refused and the body is capped at 4 KiB.

A browser counts once per side of a rollout: one load and at most one error per `u` and version, however often it reports. The server works out which side `u` belongs to (the candidate when `u` falls inside the percent, else stable) and drops a report for the other side, without an error. A remote named twice in one body is refused. When a step moves a browser from stable to candidate, it may report both, since each is its own version. Running counts are kept beside the rows and updated in the same transaction, so the gate reads them without scanning. The rows are in SQLite (`rollout_reporters`), removed when the rollout ends.

Each rollout counts at most `MFEFLOW_REGISTRY_ROLLOUT_MAX_REPORTERS` browsers (20000 by default). Past that, new ids are dropped and still answered `202`. A full cap means the gate has stopped learning, so it fails open: a bad candidate can then go unnoticed. The status endpoint shows `reporterCap.full`. Raise the cap if you see it, or end the rollout.

Each client address gets a token bucket in memory (60 at once, then 60 a minute by default). Past that the answer is `429` with `Retry-After`. By default the address is the socket's, so behind a proxy every browser shares one bucket. Set `MFEFLOW_REGISTRY_TRUST_PROXY=true` there, and the server uses the last `X-Forwarded-For` entry. It warns at start when it is bound beyond loopback without that setting.

The endpoint cannot prove a report is honest. Anyone can make up many ids, and that can still sway the gate. The caps, the one-count-per-id rule and the minimum number of clients make it costly, not impossible. Treat the gate as a safety net, not a security control.

**The shell side.** In `@mfeflow/runtime`, set `"registryBeacon": true` in `runtime-config.json` and read the sources with `registrySourcesWithBeacon()` from `@mfeflow/runtime/beacon` instead of `registrySources()`. It adds a random id kept in `localStorage` to the server index URL as `u`, and counts one load per remote per page, plus one error if that remote failed. It sends one request for the whole page when the page is hidden. It is off unless the config asks, and a shell that imports it on demand downloads nothing otherwise.

The id is a random value kept in `localStorage`. It is a persistent identifier for that browser, so check your consent and privacy rules before turning the option on.

**Caching.** The index is `Cache-Control: private, max-age=5`. A CDN or shared proxy must not cache it: the response depends on the client (`u`) during a rollout, and a shared cache would hand one client's answer to another. Browsers keep it for 5 seconds. The static fallback index is separate, and public for 60 seconds.

**Tokens.** `mfr_<id>.<secret>`, sent as `Authorization: Bearer`. Each is scoped to an env (or `*`), a remote (or `*`) and actions: `read`, `deploy`, `promote`, `rollback`, `kill`, `rollout`, `admin` (all of them). `rollout` is its own action because step, complete and abort change who gets which version, which is neither a deploy nor an env-to-env promote. Starting a rollout is a deploy, so it needs `deploy`. Only the SHA-256 hash is stored, compared in constant time. `token list` shows ids and scopes, `token revoke <id>` ends one. Reading the index needs no token.

**Fallback.** After every change the server rewrites `envs/<env>/index.json` on the fallback host with the stable pointers only (killed remotes left out), so shells that fall back to it still boot with the server down. A failed write is logged and retried with backoff; it never delays or fails the request. Every env is republished at start.

**Concurrent writers.** An env has a revision. A deploy, promote or rollback that read an older one gets `409 conflict` and should read again and retry, the same idea as the static `If-Match`. A kill retries by itself, because it has to land.

**Security.** The database file is created with mode 0600. Versions must be plain semver (`1.4.2`, `1.4.2-rc.1`, `1.4.2+sha`), file names from a manifest must be plain relative paths, and every artifact URL is rebuilt and checked to stay under the artifact base URL. A deploy reads at most 32 MiB from the artifact host in total, streamed with a running cap. Errors from the artifact host go to the server log, not the response. Bodies are capped and must be `application/json`. There are no CORS headers unless you list origins, and then only on the index endpoint. The server reads only URLs under the artifact base URL, with no redirects. Tokens, secrets and authorization headers are never logged. Only the beacon endpoint is rate limited; put the server behind a proxy that limits everything else.

A promote needs a token that covers both envs (`env` `*`, or `admin`), since it reads one and writes the other.

### From the CLI and Docker

`mfeflow deploy`, `promote`, `rollback`, `status`, `rollout` and `kill` talk to the server when `MFEFLOW_REGISTRY_URL` is set (the token comes only from `MFEFLOW_REGISTRY_TOKEN`). See the [CLI reference](https://mfeflow.github.io/mfeflow/reference/cli) and [Run the registry server](https://mfeflow.github.io/mfeflow/guide/registry-server-runbook).

`docker/Dockerfile` builds an image from the published package, and `docker/compose.yaml` runs it next to MinIO. The release workflow pushes `ghcr.io/mfeflow/mfeflow-registry` for each release that publishes this package.

Not here yet: Postgres.

MIT licensed.
