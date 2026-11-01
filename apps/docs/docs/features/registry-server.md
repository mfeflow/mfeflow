---
title: registry-server - publish remotes through a registry server
description: Add the files that point a project at a self-hosted mfeflow registry server - runtime config keys, a shell helper for the browser beacon, a CI workflow that deploys with a token from the environment, and a guide.
---

# registry-server

This page shows how to wire a project to a self-hosted registry server. It is optional. The [static registry](/guide/deploy-and-rollback) works without it.

## What you get

The server adds what a static index cannot do: percentage rollouts, a kill switch that works on the next request, scoped tokens and an audit log. This feature does not run the server. It sets up the project side.

- Two runtime config keys, `registryUrls` and `registryBeacon`, both off until you fill them in.
- `src/registry-sources.ts` in the shell, which adds the browser id and starts the beacon.
- `docs/registry-server.md`, a guide with your server address in it.
- Scripts `server:deploy`, `server:rollback` and `server:status`.
- With `ci-github`, a `deploy-server.yml` workflow that deploys every remote on a push to main.

## When to use it

Use it when you want to roll a release out to a share of visitors, or take a remote out of the page in seconds. If a rollback by pointer is enough, stay on the static registry.

## Add it

Add it with the address of your server, or leave the option empty and set it later:

```sh
pnpm mfeflow add registry-server --option registry-server.serverUrl=https://registry.example.com
```

What changed:

```text
apps/shell/src/registry-sources.ts
docs/registry-server.md
.github/workflows/deploy-server.yml   # only when ci-github is already in the project
```

## Use it

Set the index address for production and turn the beacon on:

```json title="apps/shell/public/config/runtime-config.prod.json"
{
  "registryUrls": ["https://registry.example.com/v1/index/prod", "/registry/index.json"],
  "registryOrigins": ["https://registry.example.com"],
  "registryBeacon": true
}
```

Then call the helper in the shell's bootstrap instead of the plain one:

```ts title="apps/shell/src/bootstrap.tsx"
import { registrySources } from './registry-sources';
```

Deploy with the token in the environment:

```sh
export MFEFLOW_REGISTRY_URL=https://registry.example.com
export MFEFLOW_REGISTRY_TOKEN=...
pnpm server:deploy catalog --env prod --percent 10 --steps 50,100
```

You should see `Rollout started: catalog@... is at 10%`. The token is read only from `MFEFLOW_REGISTRY_TOKEN`. There is no flag for it.

## Configure

| Option      | Default | Meaning                                              |
| ----------- | ------- | ---------------------------------------------------- |
| `serverUrl` | empty   | Written to the guide. Commands read the environment. |

## How it works

The shell asks the server for the index with `?u=<browser id>`. The server hashes the id to decide whether that browser gets the candidate or the stable version. The beacon reports loads and errors back, which feeds the gate. The second URL in `registryUrls` is the static fallback the server keeps up to date.

## Gotchas

- The beacon stores a random id in `localStorage`. Check your privacy rules before you turn it on.
- Plain http works only for localhost, for the server address and for the token.
- The workflow needs a `registry` environment with the token as a secret. Without `ci-github` no workflow is written.

## Reference

See [Run the registry server](/guide/deploy/registry-server-runbook), [Registry server SLOs](/guide/deploy/registry-server-slo) and [the server README](https://github.com/mfeflow/mfeflow/tree/main/packages/registry#the-server).
