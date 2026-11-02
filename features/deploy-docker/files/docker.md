# Docker

This project can package each app as a small nginx image. Everything here is plain code in your repository: change it, or delete it. mfeflow does not call it.

## Files

- `docker/Dockerfile`: one file for every app. `--build-arg APP=<name>` picks the app from `mfeflow.json`.
- `docker/nginx.shell.conf` and `docker/nginx.remote.conf`: cache rules, the SPA fallback (shell only), CORS (remotes only).
- `docker/40-mfe-config.sh`: runs before nginx starts and picks the runtime config.
- `compose.yaml`: the shell and the remotes locally, on the ports from `mfeflow.json`.
- `k8s/mfe.yaml`: the shell on Kubernetes, with the runtime config in a ConfigMap.
- `.dockerignore`.

## Build once, run in every environment

```sh
docker build -f docker/Dockerfile --build-arg APP=shell -t shop-shell:1.0.0 .
docker run --read-only --tmpfs /tmp \
  -e MFE_ENV=staging -p 8080:8080 shop-shell:1.0.0
```

`MFE_ENV` picks `runtime-config.<env>.json` from the build. The same image runs as `staging` or `prod`. If the file is missing the container stops and lists what it has.

A remote image needs the origins of the shells that may load it:

```sh
docker build -f docker/Dockerfile --build-arg APP=catalog -t shop-catalog:1.0.0 .
docker run --read-only --tmpfs /tmp \
  -e SHELL_ORIGINS=https://staging.shop.example.com -p 8081:8080 shop-catalog:1.0.0
```

## What each path is cached for

| Path                                        | Cache-Control                         |
| ------------------------------------------- | ------------------------------------- |
| `index.html`, `/config/runtime-config.json` | `no-cache`                            |
| `/registry/index.json`, `mf-manifest.json`  | `no-cache`                            |
| `/static/*` (hashed files)                  | `public, max-age=31536000, immutable` |
| `/mfe/<name>/<version>/*` on a remote       | `public, max-age=31536000, immutable` |

Bump the version in a remote's `package.json` for every release. The versioned path is cached for a year, so the same version must always mean the same files.

## Registry index

The shell reads `/registry/index.json` from its own origin. In Kubernetes put it in its own ConfigMap, mounted as a directory at `/tmp/mfe-registry`; with Docker mount a file at `/tmp/mfe-registry/index.json`, or set `registryUrls` in the runtime config to a registry you host elsewhere.

## Notes

- Compression is gzip. The nginx image has no brotli module.
- The image runs as user 101 on port 8080 and works with a read-only root filesystem. nginx and the start script both write only under `/tmp`.
- Build on Node 24. Node 25 and later no longer ship corepack.
- The base images are pinned by digest. Update the tag and the digest together.
