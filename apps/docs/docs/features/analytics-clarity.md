---
title: analytics-clarity - Microsoft Clarity that waits for consent
description: Add Microsoft Clarity session replay and heatmaps next to Google Tag Manager, loaded only after the visitor accepts analytics in the consent banner.
---

# analytics-clarity

This feature adds Microsoft Clarity, which records sessions and builds heatmaps, without breaking consent rules. Clarity sets cookies and records the page, so it requests nothing until the visitor says yes in the banner. If they later withdraw consent, it stops.

## What you get

A Clarity provider that plugs into the same analytics layer as Google Tag Manager and follows the same consent choice. The project id comes from the runtime config, not the bundle. It is off by default, and it needs [analytics-gtm](/features/analytics-gtm) first because that feature provides the consent banner.

## Add it

```sh
pnpm mfeflow add analytics-gtm analytics-clarity
```

What changed:

```text
apps/shell/src/analytics/
├── clarity.ts       # boot step: reads the id, adds the provider, never blocks first render
└── clarity.test.ts  # only if you have the testing feature
```

The runtime config also gets a new `clarityId` key.

## Use it

Copy the project id from Clarity under Settings, then Setup, and put it in the runtime config of the environment that should record:

```json title="apps/shell/public/config/runtime-config.prod.json"
{ "environment": "prod", "gtmId": "GTM-ABC123", "clarityId": "k3x9m2abcd" }
```

With an empty `clarityId`, the default, Clarity stays off. Nothing else changes in your code: the existing banner and `tracker` calls now reach Clarity as well.

Outside the generated shell, you can add the provider yourself:

```ts
import { addProvider } from '@mfeflow/analytics/providers';
import { createClarityProvider } from '@mfeflow/analytics/clarity';

addProvider(createClarityProvider({ projectId: 'k3x9m2abcd' }));
```

## Configure it

| Setting      | Where                          | Default                       |
| ------------ | ------------------------------ | ----------------------------- |
| `clarityId`  | runtime config                 | `""` (off)                    |
| `projectId`  | `createClarityProvider` option | required                      |
| `scriptUrl`  | `createClarityProvider` option | `https://www.clarity.ms/tag/` |
| `sendUserId` | `createClarityProvider` option | `false`                       |

`feature.json` has no prompts. The id must be empty or 8 to 12 lowercase letters and digits, and `pnpm check:runtime-config` checks that when you use [env-t3](/features/env-t3). Without env-t3 the key goes in `apps/shell/public/config/runtime-config.json`.

## How it works

The provider follows the visitor's consent in four steps:

1. Until `analytics_storage` is granted, nothing is requested: no script, no cookie, no Clarity function on the page.
2. When they grant it, the script is added once, and Clarity is told what was granted.
3. On a later visit the stored choice arrives at start, so a returning visitor who agreed gets Clarity from the beginning, and one who declined never does.
4. If they withdraw consent, Clarity is told so, which stops it and clears its cookies, and nothing more is sent.

Events and page paths sent while consent is missing are dropped. Granting consent does not replay the past.

The analytics package runs more than one provider through `addProvider`. Both get every call, and a provider that throws does not stop the other.

Start order does not matter. A tracker call reaches Clarity as the event name only, so nothing about the visitor leaves with it. Page views arrive as a path.

## Gotchas

:::warning
Older projects may still call `initAnalytics(createGtmProvider(...))` in `src/analytics/init.ts`. Change it to `addProvider(...)`, imported from `@mfeflow/analytics/providers`. Otherwise whichever provider starts second is ignored.
:::

- **`identify` is not sent to Clarity** unless you pass `sendUserId: true` to the provider.

- **A bad id throws at start.** The provider rejects anything that is not 8 to 12 lowercase letters and digits, and the shell logs a warning instead of starting Clarity.

- **Adding env-t3 afterwards.** The key moves into the schema and the environment files. Delete `apps/shell/public/config/runtime-config.json`, or doctor reports it as missing `environment`.

## Reference

- [analytics-gtm](/features/analytics-gtm), which owns the consent banner and the `addProvider` setup
- [env-t3](/features/env-t3), where `clarityId` is declared
- [Runtime config](/concepts/runtime-config)
- [`@mfeflow/analytics` README](https://github.com/mfeflow/mfeflow/tree/main/packages/analytics)
