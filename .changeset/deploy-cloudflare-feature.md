---
'mfeflow': minor
---

New optional feature, `deploy-cloudflare`: `mfeflow add deploy-cloudflare` writes a `wrangler.jsonc` for the shell and each remote with staging and prod environments, a `_headers` file with the cache and CORS rules, and a script that picks each environment's runtime config and registry index from one build. An R2 option serves `/registry/*` from a bucket, and with `ci-github` it adds a workflow that deploys with `cloudflare/wrangler-action`. It is one way to host on Cloudflare, not a requirement, and every file it writes is yours to change. New projects also list `workerd: false` in `allowBuilds`, so installing wrangler does not stop pnpm.
