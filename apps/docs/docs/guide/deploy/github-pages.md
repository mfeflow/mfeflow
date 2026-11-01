---
title: Deploy to GitHub Pages
description: Publish the site folder to GitHub Pages with the deploy-pages workflow, and learn the limits that matter for mfeflow, including the fixed cache time and the project base path.
---

# Deploy to GitHub Pages

This how-to publishes an mfeflow site to GitHub Pages from a workflow. It suits docs, demos and small projects. It is one option in the [Deploy overview](/guide/deploy/).

Pages is free and needs no other account. It also has limits you should know before you pick it.

## Know the limits first

GitHub Pages does not let you set response headers. You cannot make remote files immutable, and you cannot make the index short-lived.

Pages also sends its own fixed cache time. On 1 November 2026, `curl -I` on this docs site showed `cache-control: max-age=600`, which is 10 minutes. That is an observation. GitHub's docs do not state it, so check your own site.

A 10-minute cache makes a rollback slow. Users can keep the old index for up to that long.

Last, the shell asks for `/config/runtime-config.json` and `/registry/index.json` from the root of the site. A project site lives under `/<repo>/`, so those requests miss. Use a user or organization site, or a custom domain, so that the site is at the root.

## Add the workflow

The workflow builds, assembles the site folder, and hands it to Pages. The action versions are the ones this repository uses:

```yaml title=".github/workflows/pages.yml"
name: pages
on:
  push:
    branches: [main]

permissions:
  contents: read

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
      - run: sh scripts/assemble-site.sh prod https://acme.github.io site
      - run: cp site/index.html site/404.html
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

The script needs `jq`, which GitHub's Ubuntu runners include. Replace `acme.github.io` with your address.

## Make deep links work

Pages serves a file called `404.html` for any path it cannot find. The `cp` step above makes that file a copy of `index.html`.

A visit to `/catalog` then loads the shell, and the shell shows the right route.

The page still comes back with status 404. Browsers do not mind, but search engines will not index those routes. A missing file under `/mfe/` also returns the HTML page, so use `curl -I` when a remote fails to load.

## Roll back

Run the workflow again from an earlier commit, or revert the commit. Wait for the cache to expire.

## One site, one environment

A Pages site has one address. For staging and production you need two repositories, or two workflow runs that publish to different sites. If you need one build for several environments, use [Docker](/guide/deploy/docker), [Cloudflare](/guide/deploy/cloudflare) or [AWS](/guide/deploy/aws).

## Next

- Compare hosts: [Deploy overview](/guide/deploy/).
