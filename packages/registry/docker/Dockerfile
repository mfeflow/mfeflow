# The registry server as an image. It installs the published @mfeflow/registry package, so the
# build context is just this folder.
#
#   docker build -t mfeflow-registry --build-arg PACKAGE=@mfeflow/registry@0.6.0 packages/registry/docker
#
# To build from tarballs made with `pnpm pack` (put them in this folder), pass their paths under /ctx:
#   --build-arg "PACKAGE=/ctx/mfeflow-registry-0.6.0.tgz /ctx/mfeflow-contracts-0.6.0.tgz"
ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS install
ARG PACKAGE=@mfeflow/registry
WORKDIR /app
COPY . /ctx
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock --prefix /app ${PACKAGE}

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
