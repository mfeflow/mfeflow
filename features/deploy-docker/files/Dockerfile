# One Dockerfile for every app. Pick the app with a build argument:
#
#   docker build -f docker/Dockerfile --build-arg APP=shell   -t shop-shell:1.0.0 .
#   docker build -f docker/Dockerfile --build-arg APP=catalog -t shop-catalog:1.0.0 .
#
# Build once, run anywhere: nothing about an environment is baked in. The shell reads its runtime
# config at start (MFE_ENV picks runtime-config.<env>.json); a remote reads the shell origins it
# allows (SHELL_ORIGINS). Both base images are pinned by digest; Dependabot or a manual bump moves
# them. Run from the repository root so pnpm-lock.yaml is in the build context.

ARG NODE_IMAGE=node:24.22.2-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG NGINX_IMAGE=nginx/nginx-unprivileged:1.30.6-alpine3.24@sha256:2daef144b574804198caccc4041819fa1801ecd5df2252a39646bfa2b1ff3bea

# Node 24 still ships corepack; Node 25 and later do not.
FROM ${NODE_IMAGE} AS build
ARG APP=shell
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./apps/${APP}" build
RUN set -eu; \
    case "${APP}" in ''|*[!a-z0-9-]*) echo "APP must be an app name from mfeflow.json" >&2; exit 1;; esac; \
    kind="$(node -p "require('./mfeflow.json').apps['${APP}'].kind")"; \
    version="$(node -p "require('./apps/${APP}/package.json').version")"; \
    case "${version}" in ''|*[!0-9A-Za-z.+-]*) echo "unusable version: ${version}" >&2; exit 1;; esac; \
    mkdir -p /out/html /out/configs; \
    cp -R "apps/${APP}/dist/." /out/html/; \
    if [ "${kind}" = shell ]; then \
      if [ -d /out/html/config ]; then mv /out/html/config/runtime-config*.json /out/configs/; rm -r /out/html/config; fi; \
      cp docker/nginx.shell.conf /out/default.conf; \
    else \
      sed -e "s/__NAME__/${APP}/g" -e "s/__VERSION__/${version}/g" docker/nginx.remote.conf > /out/default.conf; \
    fi

FROM ${NGINX_IMAGE}
COPY --from=build /out/html /usr/share/nginx/html
COPY --from=build /out/configs /opt/mfe/configs
COPY --from=build /out/default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/40-mfe-config.sh /docker-entrypoint.d/40-mfe-config.sh
# The base image already runs as user 101 (nginx). The start script writes to /tmp/mfe-runtime.
EXPOSE 8080
# busybox wget ships with the alpine image; there is no curl.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
