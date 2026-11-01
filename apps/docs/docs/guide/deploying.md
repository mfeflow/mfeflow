---
title: Deploy
description: How to build an mfeflow project and host the output as static files today, with the same-origin /mfe/name/ layout, a registry index and a runtime config. Deploy commands are not built yet.
---

# Deploy

This guide shows how to host a built project as static files. mfeflow does not deploy for you yet. You copy the build output to a web server and write one small JSON file. The last section lists what is planned and not built.

## What does the build produce?

Build every app from the project root:

```bash
pnpm build
```

You should see a build summary for each app. Each app writes its own `dist` folder:

```text
apps/shell/dist      the shell: index.html, static/, config/, mf-manifest.json
apps/catalog/dist    a remote: static/js/..., mf-manifest.json, mf-stats.json, @mf-types.zip
apps/cart/dist       a remote
```

A remote's `mf-manifest.json` describes its files. The shell loads the remote through that manifest. Asset URLs are relative to where the remote's entry was loaded, so a remote works under any path.

## What layout does the shell expect?

The shell expects everything on one origin. The generated shell only registers remotes whose URL is on the page's own origin. Put each remote under `/mfe/<name>/`.

```text
https://app.example.com/
├── index.html                  from apps/shell/dist
├── static/                     from apps/shell/dist
├── config/runtime-config.json  one of the shell's per-environment files
├── registry/index.json         the list of remotes (you write it)
└── mfe/
    ├── catalog/                the whole of apps/catalog/dist
    └── cart/                   the whole of apps/cart/dist
```

The route `/catalog` is a path inside the shell, not a folder. Your host must send unknown paths to `index.html`. The storefront example in the repository serves this same layout in `examples/storefront/e2e/serve.ts`.

## 1. Copy the files

On any machine with the build output, assemble the folder. This example uses a `site` folder:

```bash
mkdir -p site/mfe site/registry
cp -R apps/shell/dist/. site/
cp -R apps/catalog/dist site/mfe/catalog
cp -R apps/cart/dist site/mfe/cart
```

You should see `site/index.html` and `site/mfe/catalog/mf-manifest.json`.

## 2. Pick the runtime config

The shell fetches `/config/runtime-config.json`. The build ships one file per environment. Copy the one you want to that name:

```bash
cp apps/shell/public/config/runtime-config.prod.json site/config/runtime-config.json
```

Check these files before a deploy with `pnpm check:runtime-config`. See [Runtime config](/concepts/runtime-config).

## 3. Write the registry index

The shell reads `/registry/index.json`. List each remote with its manifest URL. The `entry` must be on the same origin as the shell:

```json title="site/registry/index.json"
{
  "env": "prod",
  "remotes": [
    {
      "name": "catalog",
      "entry": "https://app.example.com/mfe/catalog/mf-manifest.json",
      "version": "1.0.0",
      "routes": ["/catalog"],
      "owner": "team-catalog"
    },
    {
      "name": "cart",
      "entry": "https://app.example.com/mfe/cart/mf-manifest.json",
      "version": "1.0.0",
      "routes": ["/cart"],
      "owner": "team-cart"
    }
  ]
}
```

The files in `registry/envs/prod` hold the same information per remote. In this release no command turns them into one index file, so you write or script it. The format is in [The registry index](/concepts/registry-index).

## 4. Serve it

Serve `site` with any static host, with a fallback to `index.html`. For a local check:

```bash
pnpm dlx serve --single site
```

You should see a local address. Open it and click catalog. The remote should load from `/mfe/catalog/`.

## Roll back by hand

To go back, put the old build of a remote back under its `/mfe/<name>/` folder, or point `entry` at an older folder. This works, but it is manual, and there is no record of what was live.

## Coming in Phase 05: not built yet

The commands below are planned. They do not exist in 0.4.0, and typing them gives an unknown command error. This section only states the intent.

| Command    | Intent                                                    |
| ---------- | --------------------------------------------------------- |
| `deploy`   | Publish one remote's build and write its registry entry   |
| `promote`  | Move a build from one environment to the next             |
| `rollback` | Change a pointer to a previous version, without a rebuild |
| `status`   | Show what each environment serves                         |

The registry entry shape already has room for this. It can hold a `previous` version and a `rollout` with a percentage. Nothing reads those fields yet. The idea is that rolling back means changing a pointer in the registry, not building the old code again.
