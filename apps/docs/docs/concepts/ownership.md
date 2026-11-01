---
title: Ownership with mfe.json
description: How the mfe.json file in each app names its owner, routes and exposed modules, and how mfeflow checks those claims so two teams cannot take the same route.
---

# Ownership with mfe.json

This page explains the small file that every app has and what mfeflow does with it. The file answers a question that gets harder as teams multiply: who owns this?

## Why does ownership need a file?

When a remote breaks in production, someone must be paged. With ten remotes, nobody remembers who owns the cart. A name in a wiki goes stale.

`mfe.json` sits in the app's folder and is reviewed with its code. It also holds the claims other tools can check, such as which URL paths the remote handles.

## What is in it?

The generated file has five fields:

```json title="apps/cart/mfe.json"
{
  "name": "cart",
  "owner": "team-cart",
  "shells": ["shell"],
  "routes": ["/cart"],
  "exposes": ["./App"]
}
```

| Field     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `name`    | The Module Federation name. Must match the app in `mfeflow.json`   |
| `owner`   | The owning team. Replace the default `team-<name>` with a real one |
| `shells`  | Shells this remote runs in. Empty for a shell                      |
| `routes`  | URL paths the remote claims                                        |
| `exposes` | Modules the remote offers                                          |

Optional fields add a `contact`, the events the remote publishes and consumes, analytics event names, a `budgets` section and `platform` ranges. See the [field reference](/reference/mfe-json).

## What does mfeflow check?

`mfeflow validate` and `doctor` read every `mfe.json` and fail on these problems:

- A file that is missing, invalid, or whose name does not match `mfeflow.json` (E113, E116)
- Two remotes that claim overlapping routes (E116)
- A registry entry missing for an environment (E114)

Overlap is checked by pattern, not by text. Comparison ignores case and a trailing slash. These pairs overlap:

```text
/checkout/*   and  /checkout/pay
/shop/:id     and  /shop/new
```

## How does it help in an incident?

The owner also appears in the registry entry and in the registry index. A tool or a person reading the index knows who owns each remote without opening the repository. Future tools can route alerts using it.

## An example of a caught mistake

Suppose the cart team adds a route that the checkout team already claims:

```json title="apps/cart/mfe.json"
{
  "name": "cart",
  "owner": "team-cart",
  "shells": ["shell"],
  "routes": ["/cart", "/checkout/*"],
  "exposes": ["./App"]
}
```

Run the check:

```bash
pnpm mfeflow validate
```

You should see an E116 error that names both remotes and both routes. The fix is to give each remote its own path before merging.

## What ownership does not give you

`mfe.json` does not enforce who may edit a folder. Use your repository's code owners for that. It also does not stop a remote from importing another remote's code. Keep remotes independent and talk through events, as described in the [event-bus feature](/features/event-bus).

## Related

- Where the file lives: [Project structure](/guide/project-structure).
- Run the check in CI: [CI and budgets](/guide/ci-and-budgets).
