# registry-static

Publish your remotes to a static host and roll back by moving a pointer. Opt-in: `pnpm mfeflow add registry-static`.

## What you get

- Scripts `registry:deploy`, `registry:rollback` and `registry:status`, which run the `mfeflow` commands of the same name.
- `docs/registry.md` in your project, with your host and the commands.
- With `ci-github` in the project, `.github/workflows/deploy.yml`, which deploys every remote when `main` changes.

The feature adds no runtime code. The commands are described in [Deploying remotes](/guide/deploy-and-rollback).

## When to use it

Use it when a folder or a bucket (S3, R2, MinIO) is enough to serve your remotes. If you need percentage rollouts or a kill switch, a static host cannot do that.

## Add it

Run this in your project, with your own host:

```sh
pnpm mfeflow add registry-static \
  --option registry-static.host=s3://my-registry \
  --option registry-static.baseUrl=https://cdn.example.com
```

You should see the three scripts and `docs/registry.md` in the list of changes. Leave the options out to set them later.

## Use it

Deploy one remote to `prod`:

```sh
pnpm registry:deploy catalog --env prod
```

You should see `prod now serves catalog@<version>`. If something is wrong, go back:

```sh
pnpm registry:rollback catalog --env prod
```

You should see `Rolled back from <version>`. Nothing is rebuilt.

## Options

| Option    | Default | What it is                                                       |
| --------- | ------- | ---------------------------------------------------------------- |
| `host`    | empty   | `file:<dir>` or `s3://<bucket>[/prefix]`                         |
| `baseUrl` | empty   | Where the host's files are served from, without a trailing slash |

The commands read `registry.host` and `registry.baseUrl` in `mfeflow.json` first, then these options. A flag beats both.

## Credentials

Credentials are never written to a file. Locally, set them in your shell. In CI, they come from GitHub secrets:

| Name                    | Where in GitHub                      |
| ----------------------- | ------------------------------------ |
| `AWS_ACCESS_KEY_ID`     | Secret of the `registry` environment |
| `AWS_SECRET_ACCESS_KEY` | Secret of the `registry` environment |
| `MFEFLOW_S3_ENDPOINT`   | Variable, for R2 or MinIO            |
| `MFEFLOW_S3_REGION`     | Variable                             |

## How the workflow works

The deploy workflow is a separate file from the pull request checks, so a pull request never deploys.

1. It runs on a push to `main`, or by hand from the Actions tab with an environment name.
2. It installs, builds, then reads the remotes from `mfeflow.json`.
3. For each remote it runs `mfeflow deploy`. Deploys never run at the same time.

It is only generated when `ci-github` is already in the project. Add `ci-github` first.

## Gotchas

- Rollbacks reach people when their browser's copy of the index expires, up to 60 seconds. The [bench](https://github.com/mfeflow/mfeflow/tree/main/bench) measures the rest on a local host only.
- GitHub Pages caches every file for 10 minutes and you cannot change that. A rollback there takes about 11 minutes.
- Remotes get their version from `package.json`. The [`release`](/features/release) feature keeps that number in step with Changesets.
