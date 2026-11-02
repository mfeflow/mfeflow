---
title: deploy-cloudflare - host on Cloudflare Workers
description: Add wrangler config, cache and CORS headers, a per-environment deploy script, an optional R2 registry proxy and, with ci-github, a workflow for hosting the shell and remotes on Cloudflare Workers static assets.
---

# deploy-cloudflare

This page shows how to add files for hosting on Cloudflare Workers. It is optional, and it is one way among several. The [Deploy overview](/guide/deploy/) compares the others, and the [Cloudflare guide](/guide/deploy/cloudflare) shows the same setup written by hand.

## What you get

Every file is ordinary code that you own. Edit or delete any of them.

- A `wrangler.jsonc` in the shell and in each remote. Each app is its own Worker with static assets, with a `staging` and a `prod` environment. Only the shell has the single-page fallback.
- A `public/_headers` in each of those apps. It holds the cache rules, and on remotes the CORS header.
- `deploy/cloudflare.json`, where you write the address of each environment.
- `scripts/deploy-cloudflare.ts` and the script `pnpm deploy:cloudflare`.
- `docs/cloudflare.md`, a guide written for your project.
- With `ci-github`, a `deploy-cloudflare.yml` workflow.
- `wrangler` as a dev dependency.

## When to use it

Use it when you want static hosting on Cloudflare and would rather start from working files than write them. If you host somewhere else, or already have your own pipeline, skip it.

## Add it

```sh
pnpm mfeflow add deploy-cloudflare
```

What changed:

```text
apps/shell/wrangler.jsonc
apps/shell/public/_headers
apps/catalog/wrangler.jsonc          # and one for each remote
apps/catalog/public/_headers
deploy/cloudflare.json
scripts/deploy-cloudflare.ts
docs/cloudflare.md
.github/workflows/deploy-cloudflare.yml   # only when ci-github is already in the project
```

Add `ci-github` first if you want the workflow. A remote added later gets its own two files.

## Use it

Put the real addresses in `deploy/cloudflare.json`. The script stops on an empty address or an `example.com` one.

```json title="deploy/cloudflare.json"
{
  "registry": "assets",
  "envs": {
    "prod": {
      "shell": "https://shop.acme.dev",
      "remotes": { "catalog": "https://catalog.acme.dev" }
    }
  }
}
```

Then build once and deploy an environment:

```sh
pnpm build
pnpm deploy:cloudflare prod --dry-run
pnpm deploy:cloudflare prod
```

You should see a line such as `staged shell for prod: apps/shell/.mfeflow/cloudflare/prod` for each app. The build is not repeated for another environment. The script copies each `dist` and changes only the copy: it picks `runtime-config.<env>.json`, writes `registry/index.json`, and puts the shell's address into each remote's CORS header.

## Configure

| Option    | Default | Meaning                                                                                                                                    |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `r2Proxy` | `false` | Serve `/registry/*` from an R2 bucket through a small Worker. The remotes are then published with `mfeflow deploy`, so they get no Worker. |

```sh
pnpm mfeflow add deploy-cloudflare --option deploy-cloudflare.r2Proxy=true
```

## How it works

The shell and each remote are separate Workers on separate origins, so remotes are loaded across origins. That is why remotes answer with `Access-Control-Allow-Origin` and why the script adds their origins to `registryOrigins`. Cloudflare makes one Worker per environment, with its own name. Bindings and `vars` are not inherited by an environment, so the R2 option repeats them in each block.

The workflow builds once, uploads the `dist` folders, and deploys each app and environment as one job of a matrix with `cloudflare/wrangler-action`. A push to `main` deploys staging. A manual run can choose `prod`.

## Gotchas

- The workflow needs the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the GitHub environments `cloudflare-staging` and `cloudflare-prod`.
- `_headers` does not apply to responses a Worker makes. The R2 proxy sets its own `Cache-Control`.
- Adding a remote means adding its address to each environment in `deploy/cloudflare.json`. The script says so when it is missing.
- Remove the feature by deleting these files and running `pnpm remove wrangler`.

## Reference

See [Deploy to Cloudflare](/guide/deploy/cloudflare) and [One build, three platforms](/guide/deploy/multi-platform).
