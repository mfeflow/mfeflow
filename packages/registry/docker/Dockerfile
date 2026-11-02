# The registry server as an image. It installs @mfeflow/registry exactly as a lockfile says, so the
# build context must hold a package.json and a package-lock.json. The base image is pinned by
# digest; Dependabot moves it. The build stops if the lock is missing.
#
# The release workflow makes both files for the version it just published. For a local build, make
# them in this folder first.
#
# A published version:
#   cd packages/registry/docker
#   npm install --package-lock-only --ignore-scripts @mfeflow/registry@0.6.0
#   docker build -t mfeflow-registry .
#
# Tarballs made with `pnpm pack` (copy them into this folder first; the lock then points at them
# with relative file: paths, which resolve after the copy into /app):
#   npm install --package-lock-only --ignore-scripts ./mfeflow-registry-0.6.0.tgz ./mfeflow-contracts-0.6.0.tgz
#   docker build -t mfeflow-registry .
#
# These files are generated; .gitignore keeps them out of commits.
ARG NODE_IMAGE=node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS install
WORKDIR /app
COPY . /app
RUN test -f package.json && test -f package-lock.json || { \
      echo "package.json and package-lock.json are missing from the build context; see the top of this Dockerfile" >&2; \
      exit 1; \
    }
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm -f /app/*.tgz

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH \
    MFEFLOW_REGISTRY_BIND=0.0.0.0 \
    MFEFLOW_REGISTRY_PORT=8787 \
    MFEFLOW_REGISTRY_DB=/data/registry.db
COPY --from=install /app /app
# The node user ships with the base image (uid 1000). The database is the only thing that needs to be writable.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MFEFLOW_REGISTRY_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["mfeflow-registry"]
CMD ["serve"]
