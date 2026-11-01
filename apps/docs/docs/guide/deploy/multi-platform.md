---
title: One build, three platforms
description: A worked example that builds once in GitHub Actions and deploys to two Cloudflare Workers and one Docker platform, each with its own runtime config and index, then rolls one platform back.
---

# One build, three platforms

This is a worked example, not the required way. It shows one build deployed to three platforms, each with its own runtime config and registry index. Take the parts that fit and drop the rest.

The setup: two platforms on Cloudflare, named `cf-a` and `cf-b`, and one Docker platform named `docker-prod`. A fourth target, staging, comes first.

It uses the pieces from the [Cloudflare](/guide/deploy/cloudflare) and [Docker](/guide/deploy/docker) pages.

## What does the layout look like?

Every platform serves the same remote files. Only the two small files differ.

```text
                    one build (artifact "dist")
                              |
        +----------+----------+-----------+
        |          |          |           |
     staging     cf-a        cf-b     docker-prod
     Worker      Worker      Worker    nginx image
        |          |          |           |
   config+index config+index config+index config+index
   staging       cf-a        cf-b     docker-prod
        |          |          |           |
 staging.shop..  a.shop..   b.shop..    shop.example.com
```

Each runtime config has its own API address. It keeps `environment` set to `prod`, because the generated schema only allows three values.

File names can be anything that matches `runtime-config.<name>.json`.

```json title="apps/shell/public/config/runtime-config.cf-a.json"
{
  "environment": "prod",
  "apiUrl": "https://api-a.example.com"
}
```

Make one such file for each of the four targets. The assemble script reads the file that matches the target name.

## Describe the Cloudflare targets

One config file holds all three Cloudflare Workers. Each is an environment, and each uploads its own folder:

```jsonc title="wrangler.jsonc"
{
  "name": "shop",
  "compatibility_date": "2026-10-31",
  "env": {
    "staging": {
      "routes": [{ "pattern": "staging.shop.example.com", "custom_domain": true }],
      "assets": { "directory": "./site-staging", "not_found_handling": "single-page-application" },
    },
    "cf-a": {
      "routes": [{ "pattern": "a.shop.example.com", "custom_domain": true }],
      "assets": { "directory": "./site-cf-a", "not_found_handling": "single-page-application" },
    },
    "cf-b": {
      "routes": [{ "pattern": "b.shop.example.com", "custom_domain": true }],
      "assets": { "directory": "./site-cf-b", "not_found_handling": "single-page-application" },
    },
  },
}
```

Keep the `_headers` file from the Cloudflare page in `apps/shell/public`. The Docker platform uses `docker/Dockerfile.prebuilt` and the files from the Docker page.

## Build once and upload it

Two workflows share one deploy file. The release workflow builds once and uploads the result as an artifact. The artifact holds every `dist` folder and every `package.json`, so a later rollback knows the versions that were built:

```yaml title=".github/workflows/release.yml"
name: release
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
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: |
            apps/*/dist
            apps/*/package.json

  staging:
    needs: build
    uses: ./.github/workflows/deploy-target.yml
    permissions:
      contents: read
      actions: read
      packages: write
    with:
      target: staging
      build_run: ${{ github.run_id }}

  promote:
    needs: staging
    strategy:
      fail-fast: false
      matrix:
        target: [cf-a, cf-b, docker-prod]
    uses: ./.github/workflows/deploy-target.yml
    permissions:
      contents: read
      actions: read
      packages: write
    with:
      target: ${{ matrix.target }}
      build_run: ${{ github.run_id }}
```

The `promote` job runs once per platform, in parallel. A failure on one does not stop the others. In GitHub, add a required reviewer to an environment such as `docker-prod` to hold that platform until someone approves.

## Deploy one target

This reusable workflow does the same steps for every target. It looks up the origin and the kind, downloads the artifact of the build run you name, and deploys. Each run uses a GitHub environment named after the target, so each platform has its own secrets:

```yaml title=".github/workflows/deploy-target.yml"
name: deploy-target
on:
  workflow_call:
    inputs:
      target:
        type: string
        required: true
      build_run:
        type: string
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.target }}
    permissions:
      contents: read
      actions: read
      packages: write
    env:
      TARGET: ${{ inputs.target }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - id: where
        run: |
          case "$TARGET" in
            staging)     echo "origin=https://staging.shop.example.com" >> "$GITHUB_OUTPUT"; echo "kind=cloudflare" >> "$GITHUB_OUTPUT" ;;
            cf-a)        echo "origin=https://a.shop.example.com" >> "$GITHUB_OUTPUT"; echo "kind=cloudflare" >> "$GITHUB_OUTPUT" ;;
            cf-b)        echo "origin=https://b.shop.example.com" >> "$GITHUB_OUTPUT"; echo "kind=cloudflare" >> "$GITHUB_OUTPUT" ;;
            docker-prod) echo "kind=docker" >> "$GITHUB_OUTPUT" ;;
            *) echo "unknown target $TARGET" >&2; exit 1 ;;
          esac

      - uses: actions/download-artifact@v8
        with:
          name: dist
          path: apps
          run-id: ${{ inputs.build_run }}
          github-token: ${{ github.token }}

      - if: steps.where.outputs.kind == 'cloudflare'
        env:
          ORIGIN: ${{ steps.where.outputs.origin }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          sh scripts/assemble-site.sh "$TARGET" "$ORIGIN"
          pnpm wrangler deploy --env "$TARGET"

      - if: steps.where.outputs.kind == 'docker'
        env:
          RUN: ${{ inputs.build_run }}
          REGISTRY_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          sh scripts/prepare-image.sh
          image="ghcr.io/$(echo "$GITHUB_REPOSITORY" | tr 'A-Z' 'a-z'):build-${RUN}"
          docker build -f docker/Dockerfile.prebuilt -t "$image" .
          echo "$REGISTRY_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
          docker push "$image"
          echo "pushed $image"
```

Secrets live in each GitHub environment. The two Cloudflare platforms can hold different tokens, even different accounts.

The wrangler variable names are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The last step stops at a pushed image. How it reaches your servers is yours to choose. On Kubernetes it can be one command, which is not part of this workflow and needs cluster access:

```sh
kubectl set image deployment/shop shop=ghcr.io/acme/shop:build-1234
```

## Release flow

A merge to `main` builds once. It lands on staging first, and the other three platforms follow.

```text
 merge to main
      |
      v
   build  --->  artifact "dist"
      |
      v
   staging  (check it by hand)
      |
      +-----------+-----------+
      |           |           |
      v           v           v
    cf-a        cf-b     docker-prod
```

The `needs: staging` line is the gate. If staging fails, nothing else runs.

## Roll back one platform

A rollback redeploys an earlier build to one platform. The other platforms are not touched. Add a second workflow that you run by hand:

```yaml title=".github/workflows/rollback.yml"
name: rollback
on:
  workflow_dispatch:
    inputs:
      target:
        description: Platform to roll back
        type: choice
        options: [cf-a, cf-b, docker-prod]
        required: true
      build_run:
        description: Run id of an earlier release run
        type: string
        required: true

jobs:
  rollback:
    uses: ./.github/workflows/deploy-target.yml
    permissions:
      contents: read
      actions: read
      packages: write
    with:
      target: ${{ inputs.target }}
      build_run: ${{ inputs.build_run }}
```

Find the run id in the address of the earlier release run. Say the Docker platform has a bad release and both Cloudflare platforms are fine.

Run the rollback for `docker-prod` only.

```text
 release run 1234 (good)     release run 1250 (bad)
        |                           |
        |                    cf-a and cf-b stay on 1250
        |
        +--> rollback.yml  target=docker-prod  build_run=1234
                  |
                  v
          docker-prod serves build 1234 again
```

The deploy steps and scripts come from the current commit, and the build files come from run 1234. Artifacts expire after your repository's retention period, so older builds need another record, such as the image tags.

## Use the mfeflow commands instead

This example uploads whole sites. If your remotes live on a CDN, `mfeflow deploy`, `promote` and `rollback` fit the same flow and move only a pointer. See [Deploy and roll back a remote](/guide/deploy-and-rollback).

## Next

- Pick one host: [Deploy overview](/guide/deploy/).
