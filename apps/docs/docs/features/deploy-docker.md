---
title: deploy-docker - package the shell and remotes as nginx images
description: Add a Dockerfile with an APP build argument, nginx cache and CORS rules, a start script that picks the runtime config from MFE_ENV, a Kubernetes example, a compose file and a .dockerignore.
---

# deploy-docker

This page shows how to get Docker files for the shell and each remote. It is optional. mfeflow never builds or runs an image; the files are yours to change or delete.

## What you get

One image recipe for every app, built once and run in every environment.

- `docker/Dockerfile`: a build stage on Node 24 and an nginx runtime stage. `--build-arg APP=<name>` picks the app. Both base images are pinned by digest.
- `docker/nginx.shell.conf` and `docker/nginx.remote.conf`: the cache rules, the fallback to `index.html` (shell only) and CORS (remotes only).
- `docker/40-mfe-config.sh`: runs before nginx starts and copies `runtime-config.$MFE_ENV.json` into place.
- `compose.yaml`: the shell and every remote locally, on the ports from `mfeflow.json`.
- `k8s/mfe.yaml`: a ConfigMap, Deployment and Service for the shell.
- `.dockerignore` and `docs/docker.md`.

## When to use it

Use it when you run on Kubernetes, a VM or your own network. If you deploy to a CDN or a static host, you do not need it. The [Deploy overview](/guide/deploy/) compares the options.

## Add it

```sh
pnpm mfeflow add deploy-docker
```

What changed:

```text
docker/
├── Dockerfile
├── 40-mfe-config.sh
├── compose-registry.json
├── nginx.remote.conf
└── nginx.shell.conf
k8s/mfe.yaml
compose.yaml
.dockerignore
docs/docker.md
```

The feature has no options and adds no dependencies. It reads the apps in `mfeflow.json` once, to write `compose.yaml`. A remote you add later needs its own block there.

## Use it

Build the shell and a remote from the repository root. The build needs a `pnpm-lock.yaml`:

```sh
docker build -f docker/Dockerfile --build-arg APP=shell -t shop-shell:1.0.0 .
docker build -f docker/Dockerfile --build-arg APP=catalog -t shop-catalog:1.0.0 .
```

Run the same shell image as staging, then as production:

```sh
docker run --read-only --tmpfs /tmp -e MFE_ENV=staging -p 8080:8080 shop-shell:1.0.0
docker run --read-only --tmpfs /tmp -e MFE_ENV=prod -p 8081:8080 shop-shell:1.0.0
```

`MFE_ENV=qa` stops the container with `no runtime config for MFE_ENV=qa` and a list of the files it does have.

A remote needs the origins of the shells that may load it, as `SHELL_ORIGINS`. For everything at once on your machine:

```sh
docker compose up --build
```

## Configure it

There are no install options. These are read when the container starts:

| Variable        | Image  | Meaning                                                                        |
| --------------- | ------ | ------------------------------------------------------------------------------ |
| `MFE_ENV`       | shell  | Picks `runtime-config.<env>.json`. Not needed when a runtime-config is mounted |
| `SHELL_ORIGINS` | remote | Origins allowed by CORS, separated by commas or spaces                         |

## How it works

nginx runs every script in `/docker-entrypoint.d` before it starts. The start script writes only under `/tmp`, so the root filesystem can be read-only. The shell serves `/config/runtime-config.json` from that copy, or from a ConfigMap mounted at `/tmp/mfe-runtime`.

A remote image holds its files once and answers on two paths: `/mfe/<name>/<version>/` cached for a year, and the same files at `/` that are revalidated. Any other `/mfe/` path is a 404.

| Path                                                   | Cache-Control                         |
| ------------------------------------------------------ | ------------------------------------- |
| `index.html`, runtime config, registry index, manifest | `no-cache`                            |
| `/static/*`, `/mfe/<name>/<version>/*` on a remote     | `public, max-age=31536000, immutable` |

## Gotchas

- Bump a remote's version for every release. The versioned path is cached for a year.
- Compression is gzip. The nginx image has no brotli module.
- Node 25 and later no longer ship corepack. The Dockerfile builds on Node 24.
- Do not mount a single file from a ConfigMap with `subPath`. It never receives updates. Mount the directory.
- `HEALTHCHECK` uses busybox `wget`, which the alpine image has. Kubernetes ignores it and uses the probes in `k8s/mfe.yaml`.

## Reference

See [Deploy with Docker](/guide/deploy/docker) for the same setup written by hand, and [One build, three platforms](/guide/deploy/multi-platform).
