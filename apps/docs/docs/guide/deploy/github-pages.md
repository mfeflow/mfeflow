---
title: Deploy to GitHub Pages
description: Publish the site folder to GitHub Pages with the deploy-pages workflow, and learn the limits that matter for mfeflow, such as fixed cache time and base path.
---

# Deploy to GitHub Pages

This how-to publishes an mfeflow site to GitHub Pages from a workflow. It suits docs, demos and small projects. It is one option in the [Deploy overview](/guide/deploy/).

Pages is free and needs no other account. It also has limits you should know before you pick it.

## Know the limits first

GitHub Pages does not let you set response headers. You cannot make remote files immutable, and you cannot make the index short-lived.

Pages also sends its own fixed cache time. On 1 November 2026, `curl -I` on this docs site showed `cache-control: max-age=600`, which is 10 minutes. That is an observation. GitHub's docs do not state it, so check your own site.

A 10-minute cache makes a rollback slow. Users can keep the old index for up to that long.

A project site lives under the repository name, for example `https://acme.github.io/demo/`. The shell has to know that path, or its scripts, its runtime config and its links all point at the root of the host. [Set a base path](#serve-the-shell-under-a-project-path) when you build it. A user or organization site, or a custom domain, is at the root and needs no base path.

## Serve the shell under a project path

A base path is the part of the address after the host: `/demo/` for `https://acme.github.io/demo/`. Give it to the shell's build with an environment variable, so no code changes between a root site and a project site:

```sh
MFEFLOW_BASE_PATH=/demo/ MFE_ENV=prod pnpm --dir apps/shell build
```

You can also write it in the shell's config as the `basePath` option of the shell preset. The option wins over the variable. Missing slashes are added, so `demo` and `/demo/` mean the same. A full URL or a path with dots, a question mark or a hash is an error.

The build then does four things:

- The scripts and styles load from under `/demo/`. Rsbuild gets an asset prefix and Vite gets its `base`.
- The shell fetches its runtime config from `/demo/config/runtime-config.json`.
- With `MFE_ENV` set at build time, the shell looks for the registry at `/demo/envs/prod/index.json`, the file that deploy writes. Without it the shell looks under `/demo/registry/`. A registry address in the runtime config wins over both.
- The generated router and nav read the path without the base and link with it. The links from route-factory use the base the shell was built with, so links between remotes carry it too.

Without a base path, none of this changes: the same files and the same URLs as before. Remotes need nothing, because they load from the address in the registry.

A shell made before this change keeps its old router, which ignores the base. `mfeflow upgrade` patches it. If you edited the router yourself, call the base helpers of the runtime package in it. In dev, `pnpm dev` with the variable set serves the shell at `/demo/`.

## Add the workflow

The workflow builds everything, builds the shell again for the project path, puts the remotes and the registry next to it with `mfeflow deploy`, and hands the folder to Pages. The action versions are the ones this repository uses:

```yaml title=".github/workflows/pages.yml"
name: pages
on:
  push:
    branches: [main]

permissions:
  contents: read

env:
  SITE: https://acme.github.io/demo

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      # The shell again, for /demo/. MFE_ENV=prod makes /demo/envs/prod/index.json its default registry.
      - run: pnpm --dir apps/shell build
        env:
          MFEFLOW_BASE_PATH: /demo/
          MFE_ENV: prod
      - name: Assemble the site
        run: |
          mkdir site
          cp -R apps/shell/dist/. site/
          mkdir -p site/envs/prod/shell
          cp apps/shell/dist/mf-manifest.json site/envs/prod/shell/mf-manifest.json
          for remote in catalog cart; do
            pnpm exec mfeflow deploy "$remote" --env prod --host file:site --base-url "$SITE" --no-local-entry --yes
          done
          cp site/config/runtime-config.prod.json site/config/runtime-config.json
          cp site/index.html site/404.html
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

In the repository settings, set Pages to deploy from GitHub Actions. The deploy job needs `pages: write` and `id-token: write`, as GitHub's docs say.

Replace the address, the base path and the remote names with yours. The base URL is the address of the site folder, with the project path and no trailing slash. `mfeflow deploy` writes each remote under `<name>/<version>/` and the index to `envs/prod/index.json`, both with that address in front. The no-local-entry flag keeps it from writing a registry file into the checkout.

These steps were run on a generated project with the Rsbuild preset and with the Vite preset, served under a project path by a local server that stands in for Pages. The shell rendered, the nav linked under the base, both remotes loaded from their versioned folders, a reload on a deep link came back with the right page, and the browser console had no errors.

## Make deep links work

Pages serves a file called `404.html` for any path it cannot find. The last copy step in the workflow makes that file a copy of the shell's page. On a project site this works for every path under the project.

A visit to `/catalog` then loads the shell, and the shell shows the right route.

The page still comes back with status 404. Browsers do not mind, but search engines will not index those routes. A missing file under `/mfe/` also returns the HTML page, so use `curl -I` when a remote fails to load.

## Roll back

Run the workflow again from an earlier commit, or revert the commit. Wait for the cache to expire.

## One site, one environment

A Pages site has one address. For staging and production you need two repositories, or two workflow runs that publish to different sites. If you need one build for several environments, use [Docker](/guide/deploy/docker), [Cloudflare](/guide/deploy/cloudflare) or [AWS](/guide/deploy/aws).

## Next

- Compare hosts: [Deploy overview](/guide/deploy/).
