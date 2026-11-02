---
title: Deploy to Cloudflare
description: Host the shell and remotes on Cloudflare Workers static assets with wrangler, set cache headers and environments, and optionally keep remotes and the registry index in R2.
---

# Deploy to Cloudflare

This how-to puts an mfeflow site on Cloudflare Workers static assets. It is one option among several in the [Deploy overview](/guide/deploy/). The second half covers R2, for teams that want remotes and the index outside the shell.

You can write the files below by hand, or run `mfeflow add deploy-cloudflare` for files you can edit. The feature does not copy this page. This page serves one site folder from one Worker, and the feature gives the shell and each remote its own Worker, with CORS between them. See [deploy-cloudflare](/features/deploy-cloudflare) for what it adds. The steps here stay valid either way.

You need a Cloudflare account, a domain on Cloudflare, and the `site` folder from the overview. Cloudflare's own docs cover each step in more depth: [static assets](https://developers.cloudflare.com/workers/static-assets/) and [R2](https://developers.cloudflare.com/r2/).

## Deploy the site folder

Install wrangler in the project:

```sh
pnpm add -D wrangler
```

Build the site folder for each environment. The origin must be the domain you will serve it from:

```sh
sh scripts/assemble-site.sh prod https://shop.example.com
sh scripts/assemble-site.sh staging https://staging.shop.example.com
```

Describe the Worker in one file. The `assets.directory` setting names the folder to upload. The `single-page-application` value sends unknown paths to `index.html`:

```jsonc title="wrangler.jsonc"
{
  "name": "shop",
  "compatibility_date": "2026-10-31",
  "routes": [{ "pattern": "shop.example.com", "custom_domain": true }],
  "assets": {
    "directory": "./site-prod",
    "not_found_handling": "single-page-application",
  },
  "env": {
    "staging": {
      "routes": [{ "pattern": "staging.shop.example.com", "custom_domain": true }],
      "assets": {
        "directory": "./site-staging",
        "not_found_handling": "single-page-application",
      },
    },
  },
}
```

Deploy production, then staging:

```sh
pnpm wrangler deploy
pnpm wrangler deploy --env staging
```

You should see wrangler upload the files and print the address the Worker runs on. Open the domain and click a remote route.

Each environment is a separate Worker. Cloudflare names the staging one `shop-staging`. Bindings and `vars` are not inherited by an environment, so repeat them in each block that needs them.

## Set the cache headers

Workers send `Cache-Control: public, max-age=0, must-revalidate` for static assets. That is already right for `index.html`, the runtime config and the index. Only the files that never change need a longer time.

Put a `_headers` file in the shell's `public` folder. The build copies it into `dist`, and the assemble script copies it on:

```text title="apps/shell/public/_headers"
/mfe/*
  Cache-Control: public, max-age=31536000, immutable
/static/*
  Cache-Control: public, max-age=31536000, immutable
```

Cloudflare allows 100 rules in this file. It does not apply to responses your own Worker code creates.

## Beware the SPA fallback

With `single-page-application`, any path that is not a file returns `index.html` with status 200. That includes a mistyped `/mfe/...` URL.

If a remote fails to load, run `curl -I` on its manifest URL. Check that you get JSON, not HTML.

## Keep remotes and the index in R2

R2 is Cloudflare's object storage. Use it when a remote's team should publish without redeploying the shell. The shell reads the index and the remotes from a separate origin.

Create the bucket:

```sh
pnpm wrangler r2 bucket create shop-registry
```

Connect a custom domain to it in the dashboard. Open the bucket, choose Settings, then Custom Domains. Do not serve production from the `r2.dev` address. Cloudflare rate-limits it and says it is for development only.

Allow the shell's origin to fetch from the bucket. The rules file looks like this:

```json title="cors.json"
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://shop.example.com"],
        "methods": ["GET"]
      }
    }
  ]
}
```

Apply it:

```sh
pnpm wrangler r2 bucket cors set shop-registry --file cors.json
```

Tell the shell where to look. Put this in `runtime-config.prod.json`, then assemble and deploy the site again:

```json title="apps/shell/public/config/runtime-config.prod.json"
{
  "environment": "prod",
  "registryUrls": ["https://cdn.shop.example.com/envs/prod/index.json"],
  "registryOrigins": ["https://cdn.shop.example.com"]
}
```

### Push remotes with the mfeflow commands

This is one option. `mfeflow deploy` uploads a remote's files and writes the index for you, and `promote` and `rollback` move it. R2 speaks the S3 protocol, so you set an endpoint:

```sh
export MFEFLOW_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export MFEFLOW_S3_REGION=auto
export AWS_ACCESS_KEY_ID=<r2 key id>
export AWS_SECRET_ACCESS_KEY=<r2 secret>
mfeflow deploy catalog --env prod --host s3://shop-registry --base-url https://cdn.shop.example.com
```

The key and secret come from an R2 API token. Follow [Deploy and roll back a remote](/guide/deploy-and-rollback) for the output and the flags. The files land under `<name>/<version>/` and the index under `envs/<env>/index.json`.

### Or upload the files yourself

Nothing requires the commands. The AWS CLI can copy to R2 with its `--endpoint-url` flag. R2 lists the calls a sync needs (list, head, put) as supported, but its docs do not show `sync`, so test on a staging bucket first:

```sh
aws s3 sync apps/catalog/dist s3://shop-registry/catalog/1.2.0 \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --cache-control "public, max-age=31536000, immutable"
```

For one file at a time, wrangler works. The `--remote` flag makes it talk to the real bucket:

```sh
pnpm wrangler r2 object put shop-registry/envs/prod/index.json \
  --file site-prod/registry/index.json --content-type application/json \
  --cache-control "public, max-age=60" --remote
```

Upload the index last, after every file it points to.

## Optional: serve the index from the shell's domain

You may want the shell's own address to answer `/registry/index.json` and `/config/runtime-config.json`, with the data in R2. A small Worker can do that. The `run_worker_first` setting makes it run for those two paths only.

```jsonc title="wrangler.jsonc"
{
  "name": "shop",
  "main": "src/worker.js",
  "compatibility_date": "2026-10-31",
  "vars": { "MFE_ENV": "prod" },
  "r2_buckets": [{ "binding": "REGISTRY", "bucket_name": "shop-registry" }],
  "assets": {
    "directory": "./site-prod",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/registry/*", "/config/*"],
  },
}
```

The Worker maps each path to an R2 key. It must set `Cache-Control` itself, because `_headers` does not apply to Worker responses:

```js title="src/worker.js"
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const keys = {
      '/registry/index.json': `envs/${env.MFE_ENV}/index.json`,
      '/config/runtime-config.json': `config/runtime-config.${env.MFE_ENV}.json`,
    };
    const key = keys[pathname];
    if (key === undefined) return new Response('Not found', { status: 404 });

    const object = await env.REGISTRY.get(key);
    if (object === null) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(object.body, { headers });
  },
};
```

Upload `config/runtime-config.prod.json` to the bucket yourself. This Worker is a sketch checked against Cloudflare's docs, not a tested package.

## Pages is for existing projects

Cloudflare's own docs say "Start new projects with Workers." This page therefore uses Workers. If you already host on Pages, you can keep it. Check Cloudflare's Pages docs for its header and fallback rules, which this page does not cover.

## Next

- Run it in CI: [One build, three platforms](/guide/deploy/multi-platform).
- Compare hosts: [Deploy overview](/guide/deploy/).
