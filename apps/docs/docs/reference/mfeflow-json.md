---
title: mfeflow.json reference
description: Every field of mfeflow.json, the file where the CLI records a project's apps, features, copied-file hashes, registries and budget overrides, with types, rules and an example.
---

# mfeflow.json reference

This page lists every field of `mfeflow.json` at the root of a project. The CLI writes and updates it. You edit only `budget` and `registries` by hand. For the concept, see [Project structure](/guide/project-structure).

The JSON Schema is published at `https://mfeflow.github.io/mfeflow/schema/mfeflow.json`. Point your editor at it with `$schema`.

## Example

```json title="mfeflow.json"
{
  "$schema": "https://mfeflow.github.io/mfeflow/schema/mfeflow.json",
  "version": 1,
  "topology": "monorepo",
  "packageManager": "pnpm",
  "scope": "@demo",
  "apps": {
    "shell": { "kind": "shell", "path": "apps/shell", "port": 4300 },
    "catalog": { "kind": "remote", "path": "apps/catalog", "port": 4311 }
  },
  "features": {
    "core": { "version": "0.1.0" },
    "env-t3": { "version": "0.1.0", "options": { "validator": "zod" } }
  },
  "budget": { "baselineKb": 85 }
}
```

## Fields

| Field            | Type                             | Required | Meaning                                                                                          |
| ---------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `$schema`        | text                             | No       | Schema URL for editors                                                                           |
| `version`        | `1`                              | Yes      | Format version. Must be 1                                                                        |
| `topology`       | `monorepo`, `polyrepo`, `hybrid` | Yes      | Repository layout. The CLI creates `monorepo` and `polyrepo`, not `hybrid`, in this release      |
| `repo`           | `platform`, `shell`, `remote`    | No       | Which repo of a polyrepo this is. Absent in a monorepo. A platform or remote repo needs no shell |
| `packageManager` | `pnpm`, `npm`                    | Yes      | The CLI supports only `pnpm` in this release                                                     |
| `scope`          | text                             | Yes      | npm scope for the project's packages, such as `@shopco`. Pattern `^@[a-z0-9][a-z0-9-._]*$`       |
| `apps`           | object                           | Yes      | One entry per app, keyed by name. Needs at least one shell, except in a platform or remote repo  |
| `features`       | object                           | Yes      | Installed features, keyed by name                                                                |
| `files`          | object                           | No       | Hash of each copied file, keyed by relative path                                                 |
| `kept`           | object                           | No       | Files `upgrade --keep` left alone, keyed by relative path                                        |
| `envKeys`        | object                           | No       | Keys `add env-key` wrote, keyed by the file they are in                                          |
| `registries`     | object                           | No       | Third-party feature registries, keyed by namespace                                               |
| `local`          | text                             | No       | Path to a built mfeflow checkout. Set by `--local` only                                          |
| `budget`         | object                           | No       | Overrides of the cost-model limits                                                               |

## apps

Keys are Module Federation names: lowercase words of letters and digits joined by single underscores.

| Field  | Type                    | Required | Meaning                                            |
| ------ | ----------------------- | -------- | -------------------------------------------------- |
| `kind` | `shell`, `remote`       | Yes      | The role of the app                                |
| `path` | text                    | Yes      | Folder of the app, such as `apps/cart`             |
| `port` | whole number 1 to 65535 | No       | Dev server port. Two apps may not share one (E115) |

## features

| Field     | Type   | Required | Meaning                                       |
| --------- | ------ | -------- | --------------------------------------------- |
| `version` | text   | Yes      | The feature version that was applied          |
| `options` | object | No       | The options chosen when the feature was added |

Feature names look like `analytics-gtm`, or `@someone/feature` for a registry feature.

## files

Each key is a relative path with forward slashes. Each value is `sha256-` followed by 64 hex characters. The hashes let `doctor` tell when you edited a copied file (E117, a warning). Do not edit them.

## kept

Written by `mfeflow upgrade --keep`. Each value is the hash of the new version the file was kept against. While the new version is that one, `upgrade` leaves the file out of its report. When the new version changes, the file is raised again. Do not edit it.

## envKeys

Written by `mfeflow add env-key`. Each key is a file path and each value lists the env keys that command added to it, such as `{ "env.ts": ["API_ORIGIN"] }`. When a new version of mfeflow ships another value for one of these keys, `upgrade` asks what to do instead of only warning. Projects made before this was recorded do not have it, and `upgrade` keeps warning for them. Do not edit it.

## registries

Keys are namespaces like `@acme`. Values are URL templates. The template must be https, with `{name}` in the path and optionally `{version}`.

Plain http is accepted for loopback hosts only. The namespace `@mfeflow` is reserved. See [Third-party features](/concepts/third-party-features).

## budget

All fields are numbers of at least 1. They override the defaults of the [cost model](/concepts/cost-model).

| Field        | Default | Meaning                                                                     |
| ------------ | ------- | --------------------------------------------------------------------------- |
| `shellKb`    | 32      | JavaScript the shell may add over a one-app build, in KB                    |
| `remoteKb`   | 10      | JavaScript each remote on a route may add, in KB                            |
| `lcpDeltaMs` | 300     | LCP the shell may add. Measured by your perf job, not by `mfeflow budget`   |
| `baselineKb` | none    | Initial JavaScript of your pages built as one app. Turns on the shell check |

## Errors

A missing file is E102, invalid JSON is E103 and a schema mismatch is E104. See [Error codes](/reference/errors).
