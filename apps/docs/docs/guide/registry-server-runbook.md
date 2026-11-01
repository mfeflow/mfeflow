---
title: Run the registry server
description: A how-to for the person who runs the mfeflow registry server - start it, back up the SQLite file, rotate tokens, kill a remote, recover from a halted rollout and upgrade the server.
---

# Run the registry server

This page is for whoever runs the registry server. It covers the jobs you will actually do: start it, back it up, rotate tokens, kill a remote, recover from a halted rollout and upgrade it. The server is one option. The [static registry](/guide/deploy-and-rollback) needs no server at all.

## Before you start

You need Node 22.13 or newer, or Docker. The server uses `node:sqlite`, which is unflagged from Node 22.13. Node prints an "experimental" warning for it. That is expected.

You also need a place to serve build files from, such as a bucket behind a CDN. The server never stores builds. It reads them from there, checks them and moves the pointer.

## Start it

The quickest way to see it work is the compose example. It starts the server and MinIO for artifacts:

```sh
docker compose -f packages/registry/docker/compose.yaml up -d
```

You should see both containers running with `docker compose ps`. The server answers on `127.0.0.1:8787`.

Without Docker, install the package and set the two addresses:

```sh
export MFEFLOW_REGISTRY_ARTIFACT_BASE_URL=https://cdn.example.com
export MFEFLOW_REGISTRY_FALLBACK_HOST=s3://my-registry
pnpm exec mfeflow-registry serve
```

You should see a log line ending in `listening on http://127.0.0.1:8787`. Check it with `curl http://127.0.0.1:8787/healthz`, which answers `{"ok":true}`.

Put TLS in front of it before anyone outside your machine uses it. The server binds to loopback unless you set `MFEFLOW_REGISTRY_BIND`. Every setting is listed in the [package README](https://github.com/mfeflow/mfeflow/tree/main/packages/registry#the-server).

## Make the first token

Create a token on the server itself. This is the only time its value is shown:

```sh
mfeflow-registry token create --env prod --remote '*' --actions read,deploy,rollback,kill,rollout
```

You should see the token on stdout and `Token <id> created` on stderr. Store it as `MFEFLOW_REGISTRY_TOKEN` in your CI secrets. Under Docker, run the same command with `docker compose exec registry` in front.

Give each token the fewest actions and the narrowest env it needs. A CI job that only deploys to staging gets `deploy` on `staging`.

## Back up the SQLite file

Everything the server knows is in one file: pointers, version records, tokens and the audit log. Lose it and you lose the pointers.

The database runs in WAL mode, so do not copy the file while the server runs. Ask SQLite for a consistent copy instead:

```sh
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.env.MFEFLOW_REGISTRY_DB).exec(\"VACUUM INTO '/backups/registry.db'\")"
```

You should see `/backups/registry.db` appear, as one file with no `-wal` beside it. Run this on a schedule and copy the result off the machine.

To restore, stop the server, remove the old `-wal` and `-shm` files, put the backup in place and start it again. The server republishes the fallback index for every env at start, so shells that fall back get the restored state.

Builds are not in this file. Back up the artifact host the way you back up any bucket.

## Rotate a token

Rotate on a schedule, and at once when one may have leaked. Make the new token first, so nothing breaks:

1. Create a token with the same scope. See [Make the first token](#make-the-first-token).
2. Put it in the CI secret and run one deploy or `mfeflow status` to prove it works.
3. List the tokens and find the old id:

```sh
mfeflow-registry token list
```

You should see one line per token, with its env, remote and actions.

4. Revoke the old one:

```sh
mfeflow-registry token revoke <id>
```

You should see `Revoked <id>.` The old token gets a 401 on its next request. The audit log keeps its id, never its value.

## Kill a remote

Use this when a remote is hurting people right now and you cannot wait for a fix. It removes the remote from the served index:

```sh
export MFEFLOW_REGISTRY_URL=https://registry.example.com
mfeflow kill checkout --env prod --reason "payments error"
```

You should see `checkout is killed in prod: it is out of the index.` The next index request leaves it out, and the static fallback is rewritten without it. The shell shows its fallback for that route.

Two limits are worth knowing. Browsers keep the index for up to 5 seconds, so allow that. And a page that already loaded the remote keeps running it until the person reloads.

To bring it back:

```sh
mfeflow restore checkout --env prod
```

You should see `checkout is live again in prod.` A restore is refused if another remote took one of its routes meanwhile. The error is E502.

## Recover from a halted rollout

The server halts a rollout when the candidate's error rate is clearly worse than stable's. A halt is an abort: everyone is back on the stable version. Nothing needs undoing.

To see why it halted, read the audit log for the remote:

```sh
curl -s -H "Authorization: Bearer $MFEFLOW_REGISTRY_TOKEN" \
  "$MFEFLOW_REGISTRY_URL/v1/audit?env=prod&remote=checkout"
```

You should see a `rollout.halt` entry whose detail has the reason and the counts for both sides. Then:

1. Check that `mfeflow status --env prod` shows the stable version and no rollout.
2. Fix the cause. A version is immutable, so the fix needs a new version number.
3. Deploy it again with `mfeflow deploy checkout --env prod --percent 10 --steps 50,100`.

While a rollout runs, `mfeflow rollout status checkout --env prod` shows the counts and what the gate is waiting for. If the gate never reaches a verdict on a quiet remote, it needs more traffic or lower minimums. See the gate settings in the README.

To end a rollout yourself, use `mfeflow rollout abort`. To finish it, use `mfeflow rollout complete`.

## Upgrade the server

Migrations run when the server starts and only go forward. An older server cannot read a newer file, so take a backup first.

1. Back up the file. See [Back up the SQLite file](#back-up-the-sqlite-file).
2. Pull the new image, or install the new package version.
3. Restart. Under compose that is `docker compose pull && docker compose up -d`.
4. Check `/healthz` and run `mfeflow status --env prod`.

To go back, stop the server, restore the backup and start the old version. Anything written after the backup is lost, so keep that window short.

The CLI and the server are versioned together. Upgrade both in the same change when you can.

## Troubleshoot

| What you see                                   | Why, and what to do                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MFEFLOW_REGISTRY_TOKEN is not set` (E506)     | Export the token. It is never taken as a flag.                                        |
| `uses plain http` (E506)                       | Plain http is allowed only for localhost. Use https.                                  |
| `409 rollout_active` (E510)                    | A rollout is running for that remote. Complete or abort it first.                     |
| `artifact_missing` (E509)                      | The build files are not at the artifact base URL yet. Upload them, then deploy again. |
| The server stops at start and names Node 22.13 | Upgrade Node. Before 22.13, `node:sqlite` sits behind a flag.                         |

For the other E5xx codes, see [Error codes](/reference/errors). For the numbers behind the timings above, see [Registry server SLOs](/guide/registry-server-slo).
