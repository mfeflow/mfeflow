# analytics-clarity

Microsoft Clarity (session replay and heatmaps) behind `@mfeflow/analytics`, next to Google Tag Manager. Needs
[`analytics-gtm`](./analytics-gtm) first, for the consent banner. Off by default.

```sh
pnpm mfeflow add analytics-gtm analytics-clarity
```

Put the Clarity project id in the runtime config (Clarity shows it in Settings, Setup):

```json
// apps/shell/public/config/runtime-config.prod.json
{ "environment": "prod", "gtmId": "GTM-ABC123", "clarityId": "k3x9m2abcd" }
```

An empty `clarityId` (the default) keeps Clarity off.

## Consent comes first

Clarity sets cookies and records the page, so it waits for the visitor:

- Before the visitor grants `analytics_storage` in the banner, **nothing is requested**: no script, no cookie, no
  `clarity` function on `window`.
- When they grant it, the script is added, once, and Clarity is told what was granted (`consentv2`).
- On a later visit the stored choice arrives in `init`, so a returning visitor who agreed gets Clarity from the
  start, and one who declined never does.
- If they withdraw consent, Clarity is told to stop and clear its cookies, and nothing more is sent.

Events and page paths sent while consent is missing are dropped, not kept for later: granting consent does not
replay the past.

## What you get

| File                                  | What it is for                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/shell/src/analytics/clarity.ts` | The boot step. Reads `clarityId` and adds the Clarity provider, without holding up the first render. |

The runtime key is added to the schema and to every `runtime-config.<env>.json` when `env-t3` is there, and to
`public/config/runtime-config.json` when it is not.

## Two providers at once

`@mfeflow/analytics` runs more than one provider with `addProvider`. Both get every call from then on, a provider
that throws does not stop the other, and it does not matter which feature starts first. `analytics-gtm` uses
`addProvider` too (since this feature); if your `src/analytics/init.ts` is older and still calls `initAnalytics`,
change that one line, or whichever starts second is ignored.

`tracker.track('add_to_cart', { sku })` from a remote reaches Clarity as the event name only: Clarity events carry no
parameters here, so nothing about the visitor leaves with them. `identify` is not sent to Clarity unless you pass
`sendUserId: true` to `createClarityProvider`.

## Using it without the feature

```ts
import { addProvider } from '@mfeflow/analytics/providers';
import { createClarityProvider } from '@mfeflow/analytics/clarity';

addProvider(createClarityProvider({ projectId: 'k3x9m2abcd' }));
```
