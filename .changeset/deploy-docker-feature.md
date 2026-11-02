---
'mfeflow': minor
'@mfeflow/core': minor
---

New optional feature, `mfeflow add deploy-docker`. It writes a Dockerfile you can build for the shell or any remote (`--build-arg APP=<name>`), nginx configs with the cache and CORS rules, a start script that picks `runtime-config.$MFE_ENV.json` so one image runs in every environment, a Kubernetes example, a compose file and a `.dockerignore`. Both base images are pinned by digest and the image runs as a non-root user on a read-only filesystem. The files are yours to edit or delete; nothing in mfeflow builds or runs them. To write `compose.yaml`, feature templates can now read the list of apps as `it.apps`.
