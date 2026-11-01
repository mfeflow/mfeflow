---
title: mfeflow.app.json reference
description: Every field of mfeflow.app.json, the per-app file that records an owner, shells, routes, exposed modules, events, budgets and platform ranges, with types, patterns and an example.
---

# mfeflow.app.json reference

This page lists every field of `mfeflow.app.json`, the file in each app's folder. For why it exists, read [Ownership](/concepts/ownership).

The project has one `mfeflow.json` at its root. Each app has one `mfeflow.app.json` next to its code.

The JSON Schema is published at `https://mfeflow.github.io/mfeflow/schema/mfeflow-app.json`.

## Example

```json title="apps/checkout/mfe.json"
{
  "name": "checkout",
  "owner": "team-payments",
  "contact": "#payments",
  "shells": ["shell"],
  "routes": ["/checkout", "/checkout/*"],
  "exposes": ["./App"],
  "events": {
    "publishes": ["checkout.order-completed.v1"],
    "consumes": ["cart.item-added.v1"]
  },
  "budgets": { "initialJsKb": 10 },
  "platform": { "react": "^19" }
}
```

## Fields

| Field             | Type          | Required | Meaning                                                      |
| ----------------- | ------------- | -------- | ------------------------------------------------------------ |
| `$schema`         | text          | No       | Schema URL for editors                                       |
| `name`            | text          | Yes      | Module Federation name. Must match the app in `mfeflow.json` |
| `owner`           | text          | Yes      | The owning team, such as `team-payments`                     |
| `contact`         | text          | No       | A Slack channel, email or URL                                |
| `shells`          | list of names | Yes      | Shells the remote runs in. Empty for a shell                 |
| `routes`          | list of paths | Yes      | Paths the remote claims. No duplicates                       |
| `exposes`         | list of paths | Yes      | Modules the remote offers                                    |
| `events`          | object        | No       | Events the app publishes and consumes                        |
| `analyticsEvents` | list          | No       | Analytics event names the app sends                          |
| `budgets`         | object        | No       | Limits for this app                                          |
| `platform`        | object        | No       | Package ranges the remote needs from its shell               |

## Rules for values

| Field             | Rule                                                       | Example                             |
| ----------------- | ---------------------------------------------------------- | ----------------------------------- |
| `name`            | Lowercase words of letters and digits joined by single `_` | `checkout`, `order_status`          |
| `shells`          | Each item is a shell name, with the same rule              | `shell`                             |
| `routes`          | Starts with `/`. Letters, digits and `/ _ : * . -`         | `/cart`, `/shop/:id`, `/checkout/*` |
| `exposes`         | Starts with `./`                                           | `./App`                             |
| `events.*`        | `<domain>.<event>.v<major>`                                | `cart.item-added.v1`                |
| `analyticsEvents` | `<domain>_<object>_<action>`                               | `checkout_order_completed`          |

## events

| Field       | Type                | Meaning                   |
| ----------- | ------------------- | ------------------------- |
| `publishes` | list of event names | Events the app emits      |
| `consumes`  | list of event names | Events the app listens to |

Both are required inside `events`. The names use the same pattern as the event-bus package.

## budgets

| Field         | Type               | Meaning                                                                            |
| ------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `initialJsKb` | number, at least 1 | Gzip JavaScript budget for the remote's routes. `mfeflow budget` checks it         |
| `lcpMs`       | number, at least 1 | An LCP target for the app. Recorded for your perf job; the CLI does not measure it |

## platform

An object from package name to a semver range, such as `{ "react": "^19", "@mfeflow/runtime": "^0.4" }`. `mfeflow check-compat` compares each range with the version the shell has (E302).

## Checks

The validate and doctor commands check every app file against this format and against the project file. A bad file is E113.

A name that disagrees with the project file, or overlapping routes, is E116. See [Error codes](/reference/errors).

## Moving from mfe.json

Before version 0.6 this file was called `mfe.json`. The old name still works.

If an app has only `mfe.json`, the CLI reads it and prints one notice for the command. Nothing else changes.

If an app has both files, the CLI stops with E122. Keep `mfeflow.app.json` and delete `mfe.json`.

To move by hand, rename the file and change `$schema` to the new address above. The upgrade engine has a migration that does the same for you; it runs once the upgrade command ships.

The old schema address keeps working, so existing `$schema` lines still resolve in your editor.
