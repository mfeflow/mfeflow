---
title: Deploy with Docker
description: Package the shell and remotes in one nginx image that picks its runtime config and registry index per environment at start, runs read-only, and deploys to Kubernetes.
---

# Deploy with Docker

This how-to builds one image and runs it as staging and as production. The image holds the shell and the remotes. A start-up script picks the runtime config and writes the registry index for the environment you name. It is one option in the [Deploy overview](/guide/deploy/).

You need Docker, a built project, and the scripts from the overview and below. The image runs as a normal user and works with a read-only root filesystem.

## Prepare the image contents

Save this script next to `assemble-site.sh`. It lays out what the image needs. The public address stays a placeholder until the container starts:

```sh title="scripts/prepare-image.sh"
#!/usr/bin/env sh
# Usage: scripts/prepare-image.sh [out]
# Lays out everything the image needs. The origin stays a placeholder.
set -eu

out="${1:-image-context}"

sh scripts/assemble-site.sh prod '${PUBLIC_ORIGIN}' "$out/html"
mkdir -p "$out/configs"
cp apps/shell/dist/config/runtime-config.*.json "$out/configs/"
mv "$out/html/registry/index.json" "$out/index.template.json"
rm -r "$out/html/config" "$out/html/registry"
```

It needs a `runtime-config.prod.json` to exist, because the assemble script copies one. The image keeps every environment's file under `configs`.

## Write the Dockerfile

The first stage builds on Node 24 with corepack. Node 25 and later no longer ship corepack, so on a newer Node run `npm install -g corepack` first. The second stage is nginx that runs as a normal user and listens on port 8080:

```dockerfile title="docker/Dockerfile"
FROM node:24-slim AS build
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends jq \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
RUN sh scripts/prepare-image.sh /out

FROM nginx/nginx-unprivileged:stable-alpine
COPY --from=build /out/html /usr/share/nginx/html
COPY --from=build /out/configs /opt/mfe/configs
COPY --from=build /out/index.template.json /opt/mfe/index.template.json
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/40-mfe-config.sh /docker-entrypoint.d/40-mfe-config.sh
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080
```

Add a `.dockerignore` so the build context stays small. List `node_modules` and `**/dist` in it, plus any assembled site folders.

Pin the nginx tag to a version you have tested instead of `stable-alpine`.

The old `nginxinc` registry for the unprivileged image is no longer maintained. The current image is `nginx/nginx-unprivileged`.

## Configure nginx

This server block is the whole config. Read it for three things.

```nginx title="docker/nginx.conf"
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;

  gzip on;
  gzip_types text/css application/javascript text/javascript application/json image/svg+xml;

  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
  }

  location = /config/runtime-config.json {
    alias /etc/mfe/runtime/runtime-config.json;
    default_type application/json;
    add_header Cache-Control "no-cache" always;
  }

  location = /registry/index.json {
    alias /etc/mfe/runtime/index.json;
    default_type application/json;
    add_header Cache-Control "no-cache" always;
  }

  location /config/ { return 404; }
  location /registry/ { return 404; }

  location /mfe/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location /static/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    try_files $uri /index.html;
    add_header Cache-Control "no-cache" always;
  }
}
```

First, the SPA fallback is only in the last block. A missing file under `/mfe/` is a real 404, not HTML.

Second, `add_header` is repeated in every location. nginx only inherits these directives from the level above when the current level defines none. A single header at server level would vanish in any location that sets its own.

Third, the immutable header has no `always`. Without it nginx adds the header only to successful responses, so a 404 is never cached for a year.

The runtime config and the index are read from `/etc/mfe/runtime`, not from the site folder. That directory is where the start-up script writes, and where Kubernetes can mount a ConfigMap.

## Pick the environment at start

nginx runs every script in `/docker-entrypoint.d` before it starts. This one copies the right config and fills the origin into the index:

```sh title="docker/40-mfe-config.sh"
#!/bin/sh
set -eu

dir=/etc/mfe/runtime

if [ -f "$dir/runtime-config.json" ] && [ -f "$dir/index.json" ]; then
  echo "mfe: using the config already in $dir"
  exit 0
fi

env="${MFE_ENV:?set MFE_ENV to pick a runtime config}"
origin="${PUBLIC_ORIGIN:?set PUBLIC_ORIGIN to the https address users open}"
source="/opt/mfe/configs/runtime-config.$env.json"

if [ ! -f "$source" ]; then
  echo "mfe: no runtime config for MFE_ENV=$env. Available:" >&2
  ls /opt/mfe/configs >&2
  exit 1
fi

cp "$source" "$dir/runtime-config.json"
PUBLIC_ORIGIN="$origin" envsubst '${PUBLIC_ORIGIN}' < /opt/mfe/index.template.json > "$dir/index.json"
echo "mfe: serving MFE_ENV=$env at $origin"
```

An unknown environment stops the container with exit code 1. It never serves the wrong config.

## Build and run two environments

Build once. The build stage runs the prepare script for you:

```sh
docker build -f docker/Dockerfile -t shop:1.0.0 .
```

Run the same image twice. The root filesystem is read-only. nginx needs `/tmp`, and the script needs `/etc/mfe/runtime`, so both are in memory:

```sh
docker run -d --name shop-staging --read-only \
  --tmpfs /tmp --tmpfs /etc/mfe/runtime \
  -e MFE_ENV=staging -e PUBLIC_ORIGIN=https://staging.shop.example.com \
  -p 8082:8080 shop:1.0.0

docker run -d --name shop-prod --read-only \
  --tmpfs /tmp --tmpfs /etc/mfe/runtime \
  -e MFE_ENV=prod -e PUBLIC_ORIGIN=https://shop.example.com \
  -p 8081:8080 shop:1.0.0
```

Check each one:

```sh
curl -s localhost:8082/config/runtime-config.json
curl -s localhost:8081/registry/index.json | grep entry
```

You should see the staging config for the first. For the second you should see `entry` lines on `https://shop.example.com`. Headers per path:

```text
/                                    200  Cache-Control: no-cache
/catalog                             200  Cache-Control: no-cache
/config/runtime-config.json          200  Cache-Control: no-cache
/registry/index.json                 200  Cache-Control: no-cache
/mfe/catalog/1.2.0/mf-manifest.json  200  Cache-Control: public, max-age=31536000, immutable
/mfe/catalog/1.2.0/nope.js           404
/config/other.json                   404
```

Run `docker exec shop-prod nginx -t` to check the config. Without the two `--tmpfs` flags the container exits at start with an error from `cp`. That is the read-only root doing its job.

To roll back, run the previous tag. The environment settings do not change.

If CI already built the project, skip the build stage. Prepare the folder on the CI machine and use a Dockerfile with only the second half:

```dockerfile title="docker/Dockerfile.prebuilt"
FROM scratch AS build
COPY image-context /out

FROM nginx/nginx-unprivileged:stable-alpine
COPY --from=build /out/html /usr/share/nginx/html
COPY --from=build /out/configs /opt/mfe/configs
COPY --from=build /out/index.template.json /opt/mfe/index.template.json
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/40-mfe-config.sh /docker-entrypoint.d/40-mfe-config.sh
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080
```

Build it with `sh scripts/prepare-image.sh` first, then `docker build -f docker/Dockerfile.prebuilt`.

## Run it on Kubernetes

On Kubernetes the config can come from a ConfigMap instead of the start-up script. Mount the ConfigMap as a directory at `/etc/mfe/runtime`. The script sees both files and leaves them alone.

Do not mount single files with `subPath`. Kubernetes docs say a container using a ConfigMap as a `subPath` mount does not receive updates. A directory mount is updated eventually, and nginx reads the file on each request.

```yaml title="k8s/shop.yaml"
apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-runtime
data:
  runtime-config.json: |
    {
      "environment": "prod",
      "apiUrl": "https://api.example.com"
    }
  index.json: |
    {
      "env": "prod",
      "remotes": [
        {
          "name": "catalog",
          "version": "1.2.0",
          "entry": "https://shop.example.com/mfe/catalog/1.2.0/mf-manifest.json",
          "routes": ["/catalog"]
        }
      ]
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
        - name: shop
          image: shop:1.0.0
          ports:
            - containerPort: 8080
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
          volumeMounts:
            - name: runtime
              mountPath: /etc/mfe/runtime
              readOnly: true
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: runtime
          configMap:
            name: shop-runtime
        - name: tmp
          emptyDir: {}
```

To roll back the index, edit the ConfigMap and set the earlier version. Wait for the kubelet to sync, then check `/registry/index.json`. This manifest was parsed as YAML but not applied to a cluster.

## Next

- Run several platforms from one build: [One build, three platforms](/guide/deploy/multi-platform).
- Compare hosts: [Deploy overview](/guide/deploy/).
