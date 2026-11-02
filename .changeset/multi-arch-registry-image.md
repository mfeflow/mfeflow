---
'@mfeflow/registry': patch
---

The registry server image on GHCR is now built for linux/amd64 and linux/arm64, so it runs natively on Apple Silicon and Graviton. The base image is pinned by its multi-arch digest.
