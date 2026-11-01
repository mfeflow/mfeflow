---
title: The registry index
description: What the registry index is, how the shell reads it inline or by fetch, what each remote entry contains, and how per-environment registry files relate to it.
---

# The registry index

This page explains how the shell learns which remotes exist and where their files are. The index is a small JSON document. It is the one place that connects a shell to the remotes it loads.

## Why a registry?

If remote URLs are written into the shell's build, changing a URL means rebuilding the shell. A remote could not ship without the shell's team.

With a registry, the shell reads the list at runtime. A remote's team updates one entry and the shell picks it up on the next page load. The shell build stays the same.

## What does it look like?

The index is an object with a list of remotes. Only `name` and `entry` are required for each remote.

```json title="registry/index.json"
{
  "env": "prod",
  "remotes": [
    {
      "name": "cart",
      "entry": "https://app.example.com/mfe/cart/mf-manifest.json",
      "version": "1.4.2",
      "routes": ["/cart"],
      "owner": "team-cart"
    }
  ]
}
```

## What do the fields mean?

| Field                        | Meaning                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `name`                       | The Module Federation name. Letters, digits, `_`, `$` and `-`                        |
| `entry`                      | URL of the remote's `mf-manifest.json`                                               |
| `remoteEntry`                | URL of the entry script. When present, the shell registers it instead of `entry`     |
| `type`                       | How the entry script loads, such as `module` for ESM                                 |
| `entryGlobalName`            | The global the script defines, if it differs from `name`                             |
| `exposes`                    | Per exposed module, the files to preload. Used by an edge, not inlined into the page |
| `version`, `owner`, `routes` | Information for people and tools                                                     |

A remote with an invalid field is skipped and reported as `MFE_INVALID_REMOTE`. The valid remotes still load. The full schema is at the published `registry-index.json` under the docs `/schema/` path.

## How does the shell read it?

There are two paths, and the shell tries them in order.

```text
 1. window.__MFE_REGISTRY__ set by the server or edge?  -> use it, no request
 2. otherwise: GET /registry/index.json  (same origin, 5 s timeout)
```

An edge function can write the index into the HTML. That saves a request before the first remote can load. The helper `registryInjection` in `@mfeflow/contracts` produces that HTML, plus preload hints for the route's remote files.

Then the shell calls `registerRemotesFromIndex`. It skips remotes whose URL is on an origin you did not allow, and reports them. The generated shell allows its own origin.

## What are the files in registry/envs?

A project keeps one small file per remote per environment:

```json title="registry/envs/dev/cart.json"
{
  "version": "dev",
  "manifestUrl": "http://localhost:4312/mf-manifest.json",
  "owner": "team-cart"
}
```

Each file says what one remote serves in one environment. `mfeflow validate` checks them against the registry entry schema. `mfeflow dev` reads the dev folder to build the development index. For production, no command combines these files into `index.json` yet, so you write that file. See [Deploy](/guide/deploying).

## What is planned?

The entry format already allows a `previous` version and a `rollout` with a percentage. They are not read by anything yet. The plan is that a rollback changes which version an entry points to, and does not rebuild. That belongs to Phase 05 and is not built.

## Next

- See the boot sequence: [How it works](/guide/how-it-works).
- Remote ownership: [Ownership](/concepts/ownership).
