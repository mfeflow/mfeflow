# The registry server as an image. It installs the published @mfeflow/registry package, so the
# build context is just this folder. The base image is pinned by digest; Dependabot moves it.
#
# A release build puts a package.json and package-lock.json for the published version in this
# folder (the release workflow makes them), and `npm ci` installs exactly that lock.
#
# Without them, for a local build, it installs PACKAGE: a name and version, or tarballs made with
# `pnpm pack` that you put in this folder and name under /ctx:
#   docker build -t mfeflow-registry --build-arg PACKAGE=@mfeflow/registry@0.6.0 packages/registry/docker
#   --build-arg "PACKAGE=/ctx/mfeflow-registry-0.6.0.tgz /ctx/mfeflow-contracts-0.6.0.tgz"
ARG NODE_IMAGE=node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS install
ARG PACKAGE=@mfeflow/registry
WORKDIR /app
COPY . /ctx
RUN if [ -f /ctx/package-lock.json ]; then \
      cp /ctx/package.json /ctx/package-lock.json /app/ && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix /app; \
    else \
      npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix /app ${PACKAGE}; \
    fi

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
