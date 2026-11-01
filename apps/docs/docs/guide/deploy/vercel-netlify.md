---
title: Deploy to Vercel or Netlify
description: Host the site folder on Vercel or Netlify with headers and an SPA rewrite, and see why per-environment runtime config needs a build or copy step on these hosts.
---

# Deploy to Vercel or Netlify

This how-to hosts an mfeflow site on Vercel or on Netlify. Both build from git and give you preview deploys. It is one option in the [Deploy overview](/guide/deploy/).

The honest limit comes first. These hosts run your build command for each deployment, and their environment variables are read at build time. A runtime config that differs per environment therefore needs a per-environment build or copy step. You do not get "build once" here.

## Copy the right config at build time

The assemble script from the overview already does the copy. It picks the environment's runtime config and writes the index. Run it as the last part of the build, with the environment and the public address as variables:

```sh
pnpm build && sh scripts/assemble-site.sh "$MFE_ENV" "$PUBLIC_ORIGIN" site
```

Set `MFE_ENV` and `PUBLIC_ORIGIN` for each environment in the host's settings. Give each environment a fixed address, such as a custom domain. The index holds absolute URLs, so it must know the address ahead of time.

The folder `site` is what you publish. The script needs `jq`; check that your build image has it, or write the index with Node instead.

## Vercel

One file sets the build, the headers and the SPA rewrite:

```json title="vercel.json"
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm build && sh scripts/assemble-site.sh \"$MFE_ENV\" \"$PUBLIC_ORIGIN\" site",
  "outputDirectory": "site",
  "headers": [
    {
      "source": "/mfe/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/static/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/registry/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/config/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The rewrite is the single-page-app example from Vercel's docs. After the first deploy, run `curl -I` on a remote's manifest URL and check it returns JSON, not the HTML page.

## Netlify

Netlify reads `netlify.toml` for the build and for context overrides. The `[context.production]` block applies to the production branch only:

```toml title="netlify.toml"
[build]
  publish = "site"
  command = "pnpm build && sh scripts/assemble-site.sh staging https://staging.shop.example.com site"

[context.production]
  command = "pnpm build && sh scripts/assemble-site.sh prod https://shop.example.com site"
```

Here the default build is staging and the production branch overrides it. Branch deploys use the default, which is why the staging address is fixed in the file.

Headers and the fallback live in two small files that sit in the publish folder. Put them in the shell's `public` folder so the build copies them into `dist`, then the script copies them on:

```text title="apps/shell/public/_headers"
/mfe/*
  Cache-Control: public, max-age=31536000, immutable
/static/*
  Cache-Control: public, max-age=31536000, immutable
/registry/*
  Cache-Control: public, max-age=0, must-revalidate
/config/*
  Cache-Control: public, max-age=0, must-revalidate
```

```text title="apps/shell/public/_redirects"
/*  /index.html  200
```

Netlify does not let a rewrite shadow a file that exists, so real files are still served. A missing file under `/mfe/` falls to the HTML page, as on other single-page hosts.

You can write the same headers in `netlify.toml` instead. Use one place, not both. Headers in either file are global for all builds. They cannot differ by branch or deploy context unless you copy a different `_headers` file in each context's build command.

## Roll back

Both hosts keep earlier deployments. Redeploying an earlier build restores the earlier index, because the index is part of the build. The host's own docs describe how to promote an old deployment.

## When to pick something else

If you need one build for staging and production, use [Docker](/guide/deploy/docker), [Cloudflare](/guide/deploy/cloudflare) or [AWS](/guide/deploy/aws). They let you change the two small files without a rebuild.

## Next

- Compare hosts: [Deploy overview](/guide/deploy/).
