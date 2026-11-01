---
title: Deploy and roll back a remote
description: A tutorial that deploys one remote to a static registry, promotes it, rolls it back without a rebuild and checks drift, with the real output of each command.
---

# Deploy and roll back a remote

This tutorial deploys one remote to a static registry, promotes it, and rolls it back without a rebuild. It takes about ten minutes and needs no cloud account.

## Before you start

You need Node 22.12 or newer, pnpm, and a project made with `mfeflow init`. The remote must be built, so its `dist/` folder holds an `mf-manifest.json`.

The registry here is a folder on your disk. Section 7 swaps it for an S3 bucket.

## 1. Tell mfeflow where the registry lives

Every command takes a host and a base URL. The host is where files are written. The base URL is where users will fetch them.

Add both to `mfeflow.json`, so you do not repeat them:

```json
{
  "registry": {
    "host": "file:./site",
    "baseUrl": "https://cdn.example.com"
  }
}
```

The examples below pass the same values as flags, so you can try them without editing anything.

## 2. Preview the deploy

Run a dry run first. It prints the plan and writes nothing:

```sh
mfeflow deploy catalog --env staging --host file:./site --base-url https://cdn.example.com --dry-run
```

You should see:

```text
Plan for deploy catalog@1.0.0 to staging (file:/home/you/shop/site)
warning no shell manifest at envs/staging/shell/mf-manifest.json; compat used workspace versions
Would upload, in order:
  catalog/1.0.0/mf-manifest.json (342 bytes, create-only)
  catalog/1.0.0/remoteEntry.js (1500 bytes, create-only)
  catalog/1.0.0/static/js/App.js (1204 bytes, create-only)
  envs/staging/index.json (561 bytes, create-only)
Dry run: nothing was written.
```

The files go first and the index goes last. The version comes from the remote's `package.json`.

## 3. Deploy to staging

Run it again without `--dry-run`:

```sh
mfeflow deploy catalog --env staging --host file:./site --base-url https://cdn.example.com
```

You should see:

```text
deploy catalog@1.0.0 to staging (file:/home/you/shop/site)
warning no shell manifest at envs/staging/shell/mf-manifest.json; compat used workspace versions
Files: 4 uploaded, 0 already there
staging now serves catalog@1.0.0 (first deploy).
Wrote registry/envs/staging/catalog.json.
```

The warning means the shell's own manifest was not on the host. Shared versions were checked against your workspace instead. To check against the deployed shell, copy its `mf-manifest.json` to `envs/staging/shell/` on the host, or pass `--shell-manifest <file>`.

## 4. Promote it to production

Promoting copies the pointer from one environment to another. No files are uploaded:

```sh
mfeflow promote catalog --from staging --to prod --host file:./site --base-url https://cdn.example.com
```

You should see:

```text
promote catalog@1.0.0 from staging to prod (file:/home/you/shop/site)
warning no shell manifest at envs/prod/shell/mf-manifest.json; compat used workspace versions
Files: 1 uploaded, 0 already there
prod now serves catalog@1.0.0 (first deploy).
Wrote registry/envs/prod/catalog.json.
```

The only file uploaded is the `prod` index. The gates ran again against `prod`.

## 5. Ship a bad version, then roll back

Build version 1.1.0 and deploy it straight to production:

```sh
mfeflow deploy catalog --env prod --host file:./site --base-url https://cdn.example.com --yes
```

You should see:

```text
deploy catalog@1.1.0 to prod (file:/home/you/shop/site)
warning no shell manifest at envs/prod/shell/mf-manifest.json; compat used workspace versions
Files: 4 uploaded, 0 already there
prod now serves catalog@1.1.0 (was 1.0.0).
Wrote registry/envs/prod/catalog.json.
```

Version 1.1.0 turns out to be broken. Roll back:

```sh
mfeflow rollback catalog --env prod --host file:./site
```

You should see:

```text
rollback catalog@1.0.0 to prod (file:/home/you/shop/site)
warning no shell manifest at envs/prod/shell/mf-manifest.json; compat used workspace versions
Files: 1 uploaded, 0 already there
prod now serves catalog@1.0.0 (was 1.1.0).
Rolled back from 1.1.0.
Wrote registry/envs/prod/catalog.json.
```

Nothing was rebuilt. Before it moved the index, the command checked that the files of 1.0.0 still exist on the host.

To go further back, pass `--to <version>`. The version must be in the history that `mfeflow status` shows. Rolling back again never returns to the bad version.

## 6. Check what is served

`status` shows what each environment serves, the version before it, and drift:

```sh
mfeflow status --env prod --host file:./site
```

You should see:

```text
Registry file:/home/you/shop/site

prod
  index written 2026-11-01T14:37:00.736Z
  catalog  1.0.0  (no previous, rolled back from 1.1.0)
```

Now upload a new version without moving the index. This is what `--no-publish` does:

```sh
mfeflow deploy catalog --env prod --host file:./site --base-url https://cdn.example.com --no-publish
```

You should see:

```text
deploy catalog@1.2.0 to prod (file:/home/you/shop/site)
warning no shell manifest at envs/prod/shell/mf-manifest.json; compat used workspace versions
Files: 3 uploaded, 0 already there
The index was not changed; prod still serves 1.0.0.
```

Run `status` again. It reports the drift:

```text
prod
  index written 2026-11-01T14:37:00.736Z
  catalog  1.0.0  (no previous, rolled back from 1.1.0)  DRIFT
    drift: uploaded but not pointed at: 1.2.0 (deploy it, or it was uploaded with --no-publish)
```

Drift is also reported when a file in `registry/envs/<env>/` names another version than the host serves. Drift is a warning, so `status` still exits with 0.

## 7. Use an S3 bucket instead

Point `--host` at a bucket. AWS S3, Cloudflare R2 and MinIO all work. Settings and credentials come only from environment variables:

```sh
export MFEFLOW_S3_REGION=auto
export MFEFLOW_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
export AWS_ACCESS_KEY_ID=<key id>
export AWS_SECRET_ACCESS_KEY=<secret>
mfeflow deploy catalog --env prod --host s3://my-registry/mfe --base-url https://cdn.example.com
```

Leave `MFEFLOW_S3_ENDPOINT` out for AWS. Set `AWS_SESSION_TOKEN` if your credentials are temporary. Credentials are never printed, not in errors and not with `--json`.

The key needs permission to get and put objects, and to list the bucket. Without the list permission, S3 answers 403 for a missing key and the command stops.

## If something fails

A failed gate prints an error and uploads nothing. This is a budget failure:

```text
deploy catalog@1.2.0 to prod (file:/home/you/shop/site)
error MFEFLOW_E504 The remote is over its first-load JS budget: catalog@1.2.0: loads 39.1 KB of JS first; the cost model remoteKb is 10
  Fix: Cut what the remote loads first, or raise budgets.initialJsKb in its mfe.json on purpose. Nothing was uploaded. See https://mfeflow.github.io/mfeflow/guide/deploying.
  https://mfeflow.github.io/mfeflow/errors/E504
Nothing was uploaded.
```

The command exits with 7. Each gate has its own code:

| Code                   | Meaning                                                      |
| ---------------------- | ------------------------------------------------------------ |
| [E501](../errors/E501) | Schema: `mfe.json`, the manifest or the version is not valid |
| [E502](../errors/E502) | A route overlaps a route of another remote                   |
| [E503](../errors/E503) | A shared range does not fit the deployed shell               |
| [E504](../errors/E504) | The remote is over its first-load JS budget                  |
| [E505](../errors/E505) | A rollout was asked for, which a static host cannot do       |

Other problems have codes too: [E506](../errors/E506) for the host or base URL, [E507](../errors/E507) for a missing build, [E508](../errors/E508) for a version that does not exist, [E509](../errors/E509) for files missing on the host, [E510](../errors/E510) for two deploys at once, and [E511](../errors/E511) for a published version whose content changed.

Two deploys can race on one index. The second one reads the index again and retries once. If it loses again, it stops with E510 and names the time and version the other deploy left. Nothing is overwritten.

Promote and rollback skip the size gate. The size was checked when the version first deployed, and a rollback must work even if today's budget is tighter.

In an incident, `rollback --force` also skips the schema, route and compatibility checks and prints a warning. It never skips the check that the version's files are on the host.

## What you built

A registry you can host anywhere that serves files. It keeps every version, moves one pointer per environment, and goes back by changing that pointer.

How fast a rollback reaches users depends on the host's cache. The index is cached for 60 seconds. GitHub Pages caches every file for 10 minutes, so use a bucket if that is too slow.

On a local file host, a first-time visitor sees the old version about 1 second after `rollback` exits (median of 5 runs). That is the floor: it has no CDN and no bucket in it, and a returning visitor can wait up to the 60 seconds. [How it was measured](https://github.com/mfeflow/mfeflow/tree/main/bench#rollback-visiblets).

## Next

- Every flag is in the [CLI reference](/reference/cli#deploy-promote-rollback-and-status).
- Use `--json` in CI. Each command prints one JSON document and exits with a stable code.
