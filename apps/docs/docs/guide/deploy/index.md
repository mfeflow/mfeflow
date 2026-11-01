---
title: Deploy overview
description: mfeflow builds static files and leaves hosting to you. This overview shows what to upload, the cache headers every host needs, and how the common hosting options compare.
---

# Deploy overview

mfeflow builds static files and stays out of how you host them. Here are several common ways to put them online, so pick what fits your team.

Every page in this section is an option, not a requirement. You can upload `dist/` by hand, run a script, or use the `mfeflow deploy` commands for remotes.

## What gets deployed?

Four kinds of file go online. Two of them are the same in every environment, and two differ.

| Piece              | Comes from                   | Differs per environment |
| ------------------ | ---------------------------- | ----------------------- |
| The shell          | `apps/shell/dist`            | No                      |
| Each remote        | `apps/<name>/dist`           | No                      |
| The runtime config | `config/runtime-config.json` | Yes                     |
| The registry index | `registry/index.json`        | Yes                     |

The runtime config holds settings such as an API address. The index lists the remotes and where their files are. See [Runtime config](/concepts/runtime-config) and [The registry index](/concepts/registry-index).

## What is the idea behind it?

You build once. Each environment gets its own two small files next to the same build output.

```text
                 pnpm build  (once)
                       |
        +--------------+---------------+
        |              |               |
   shell dist     catalog dist     cart dist
        |              |               |
        +--------------+---------------+
                       |
        +--------------+---------------+
        |              |               |
     staging          prod          prod-eu
   config + index  config + index  config + index
```

What you tested in staging is the same code that runs in production. Only the two JSON files change.

## How do I lay the files out?

The generated shell loads everything from its own origin by default. It expects a `site` folder like this:

```text
site/
├── index.html, static/          from the shell
├── config/runtime-config.json   one file per environment
├── registry/index.json          one file per environment
└── mfe/<name>/<version>/        the whole dist of each remote
```

Putting each remote under its version keeps old versions online. That is what makes a rollback a one-line change in the index.

The script below builds this folder from finished builds. It needs `jq`. Save it in your project:

```sh title="scripts/assemble-site.sh"
#!/usr/bin/env sh
# Usage: scripts/assemble-site.sh <env> <origin> [out]
# Builds nothing. Copies finished dist folders into one site folder.
set -eu

env="$1"
origin="${2%/}"
out="${3:-site-$env}"
remotes="catalog cart"

rm -rf "$out"
mkdir -p "$out/registry" "$out/mfe"
cp -R apps/shell/dist/. "$out/"
cp "$out/config/runtime-config.$env.json" "$out/config/runtime-config.json"
find "$out/config" -name 'runtime-config.*.json' -delete

entries=""
for name in $remotes; do
  version=$(node -p "require('./apps/$name/package.json').version")
  mkdir -p "$out/mfe/$name/$version"
  cp -R "apps/$name/dist/." "$out/mfe/$name/$version/"
  entry="$origin/mfe/$name/$version/mf-manifest.json"
  entries="$entries{\"name\":\"$name\",\"version\":\"$version\",\"entry\":\"$entry\",\"routes\":[\"/$name\"]},"
done

printf '{"env":"%s","remotes":[%s]}\n' "$env" "${entries%,}" | jq . > "$out/registry/index.json"
echo "assembled $out for $env at $origin"
```

Edit the `remotes` line to match your project. Then build and run it:

```sh
pnpm build
sh scripts/assemble-site.sh prod https://shop.example.com
```

You should see:

```text
assembled site-prod for prod at https://shop.example.com
```

Open `site-prod/registry/index.json`. Each `entry` is an absolute URL on the origin you passed.

## Which cache headers does every host need?

Two rules cover every host. Files that never change get cached for a year. The files that decide what is live must be checked each time.

| Files                                                  | Cache-Control                                     |
| ------------------------------------------------------ | ------------------------------------------------- |
| `mfe/<name>/<version>/*`, hashed files under `static/` | `public, max-age=31536000, immutable`             |
| `index.html`                                           | `no-cache`                                        |
| `config/runtime-config.json`, `registry/index.json`    | `no-cache`, or a short max-age such as 60 seconds |

A rollback works by changing the index. If the index is cached for a day, users keep the broken version for a day. The pages in this section show how to set these headers on each host.

One more thing to watch. Do not send unknown paths under `mfe/` to `index.html`. A missing file would come back as HTML with status 200, and the error you see in the browser will be confusing.

## What changes when a remote is on another domain?

The shell can load remotes from a different origin, such as a CDN. Two things must be true.

First, the shell must be told to trust that origin. Add it to `registryOrigins` in the runtime config, and list the index in `registryUrls`:

```json title="config/runtime-config.json"
{
  "environment": "prod",
  "registryUrls": ["https://cdn.example.com/envs/prod/index.json"],
  "registryOrigins": ["https://cdn.example.com"]
}
```

Second, the CDN must answer with CORS headers. Browsers block a fetch of the index or a remote's manifest from another origin without `Access-Control-Allow-Origin`. Allow the shell's origin, not `*`, where the host lets you.

Rsbuild also has an `html.crossorigin` option. It adds a `crossorigin` attribute to script and style tags in the HTML it generates, and it is off by default. You only need it when a page's HTML is on a different origin than its assets.

## How do the options compare?

| Target                                             | Good for                                | Per-environment config without a rebuild       | Rollback                                           |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| [Cloudflare](/guide/deploy/cloudflare)             | Global edge, small teams, cheap storage | Yes, one Worker or folder per environment      | Redeploy the old index; waits for its cache time   |
| [Docker](/guide/deploy/docker)                     | Kubernetes, VMs, your own network       | Yes, one image and `MFE_ENV`                   | Run the previous image tag                         |
| [AWS](/guide/deploy/aws)                           | Teams already on S3 and CloudFront      | Yes, separate paths or buckets                 | Upload the old index; short TTL or an invalidation |
| [Vercel and Netlify](/guide/deploy/vercel-netlify) | Preview URLs, git-based deploys         | Only with a per-environment build or copy step | Redeploy the earlier build                         |
| [GitHub Pages](/guide/deploy/github-pages)         | Docs, demos, small projects             | Only with one workflow run per environment     | Redeploy; caches for up to 10 minutes              |
| [Your own server](/guide/deploy/own-server)        | A box you already run                   | Yes, swap two files                            | Swap the index file                                |

Rollback speed always depends on how long the index is cached. That is why the index gets a short cache time.

## Which one should I pick?

Pick the place you already run things. A new tool is a cost, and mfeflow works the same everywhere.

- You want the least to manage: Cloudflare or Vercel and Netlify.
- You run Kubernetes or your own servers: Docker.
- Your company is on AWS: S3 and CloudFront.
- It is a demo or a docs site: GitHub Pages.

Two pages go beyond one host. [Deploy and roll back a remote](/guide/deploy-and-rollback) teaches the `mfeflow deploy`, `promote` and `rollback` commands. [One build, three platforms](/guide/deploy/multi-platform) is a worked example, not the required way.
