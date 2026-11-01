---
title: analytics-gtm - Google Tag Manager with consent built in
description: Load Google Tag Manager with Consent Mode v2, send page views on route changes, and let each remote track its own typed events.
---

# analytics-gtm

This feature puts Google Tag Manager in your shell without breaking consent rules. Nothing loads until you set a container id in the runtime config, and no tag fires ahead of the visitor's choice. Each remote gets a typed tracker, so events are checked at compile time and arrive tagged with the remote that sent them.

## What you get

A shell that starts GTM from its runtime config, a cookie banner you can restyle, automatic page views, and a tracker per remote. The container id is not compiled into the bundle, so the same build can use a different container in each environment. It is off by default.

## Add it

```sh
pnpm mfeflow add analytics-gtm
```

What changed:

- `apps/shell/src/analytics/init.ts`, the boot step that reads `gtmId` and starts GTM
- `apps/shell/src/analytics/Analytics.tsx`, which wraps the shell's `App`
- `apps/shell/src/analytics/ConsentBanner.tsx`, an unstyled banner for you to restyle
- `apps/<remote>/src/analytics.ts` in every remote
- `@mfeflow/analytics` added to the shell and every remote
- a `gtmId` key in the runtime config (see below)
- unit tests next to each file, if you have the `testing` feature

## Use it

### Turn it on

Set the container in the runtime config of the environment that should use it:

```json title="apps/shell/public/config/runtime-config.prod.json"
{ "environment": "prod", "gtmId": "GTM-ABC123" }
```

With an empty `gtmId`, which is the default, no script loads and every tracker call is dropped.

### Send an event from a remote

Each remote declares the events it sends. TypeScript then checks the name and the parameters:

```ts title="apps/cart/src/analytics.ts"
import { createTracker } from '@mfeflow/analytics';

declare module '@mfeflow/analytics' {
  interface AnalyticsEvents {
    cart_viewed: undefined;
    add_to_cart: { sku: string; qty: number };
  }
}

export const events = ['cart_viewed', 'add_to_cart'] as const;
export const tracker = createTracker('cart', { events });
```

The generated file has one starter event, `<remote>_viewed`. Use the tracker in a component:

```tsx
import { useTrackOnMount } from '@mfeflow/analytics/react';
import { tracker } from '../analytics';

useTrackOnMount(tracker, 'cart_viewed'); // once per mount, also under StrictMode
tracker.track('add_to_cart', { sku, qty });
```

Every event carries `mfe_name` and `mfe_version` (`null` when the remote has none). In GTM these are the Data Layer Variables `mfe_name` and `mfe_version`. Both are always present, because the data layer merges nested objects and a missing key would keep the previous remote's value.

### Build your own consent banner

The generated banner uses a hook you can use directly:

```tsx
import { useConsent } from '@mfeflow/analytics/react';

const { decided, acceptAll, rejectAll, update, consent } = useConsent();
update({ analytics_storage: 'granted' }); // one signal at a time
```

The generated banner is honest about what each button does. **Accept analytics** grants `analytics_storage` and keeps the three `ad_*` signals denied. **Accept analytics and advertising** grants all four, and **Reject** denies them. If you change the wording, change the signals with it.

## Configure it

| Setting           | Where                      | Default           |
| ----------------- | -------------------------- | ----------------- |
| `gtmId`           | runtime config             | `""` (off)        |
| `containerId`     | `createGtmProvider` option | required          |
| `dataLayerName`   | `createGtmProvider` option | `dataLayer`       |
| `scriptUrl`       | `createGtmProvider` option | Google's `gtm.js` |
| `consentDefaults` | `createGtmProvider` option | all `denied`      |
| `waitForUpdate`   | `createGtmProvider` option | `500` ms          |
| `sendUserId`      | `createGtmProvider` option | `false`           |
| `allowPii`        | `createGtmProvider` option | `false`           |
| `pageViews`       | `<AnalyticsProvider>` prop | `true`            |

`feature.json` itself has no prompts. The `gtmId` value must be empty or `GTM-` followed by 4 to 12 capital letters or digits, and `pnpm check:runtime-config` checks that. Change the provider options in `apps/shell/src/analytics/init.ts`.

## How it works

On a first visit, the provider pushes the four consent signals to `dataLayer`, all `denied`, before it adds the `gtm.js` script. The visitor's choice is saved in `localStorage` under `mfeflow:consent`. On the next visit it is sent as a consent update right after the defaults, still before `gtm.js` is requested.

```js
dataLayer = [
  Arguments[
    ('consent',
    'default',
    {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500,
    })
  ],
  { 'gtm.start': 1730000000000, event: 'gtm.js' },
];
```

The signals are pushed as an `arguments` object because that is the only form GTM understands. An array of the same values is ignored.

`<Analytics>` sends a `page_view` with `page_path`, `page_location` and `page_title` for the first page and after every `pushState`, `replaceState`, back or forward, and hash change, whatever router you use. The same path and query is never sent twice in a row. Hash routers such as `/#/catalog?x=1` are followed. The title is read after the route renders, so a page view can reach the data layer up to 300 ms after the navigation.

In development, the tracker warns once about a name it did not declare or one GA4 would reject. GA4 names use letters, digits and underscores, start with a letter and run to 40 characters at most. Production builds stay quiet. In tests, `createRecordingProvider()` records every call and `noopProvider` drops them.

## Gotchas

:::warning
Turn off the automatic page view in your GA4 configuration tag. If you leave it on, every page is counted twice.
:::

- **Personal data is dropped by default.** Parameters named like personal data (`email`, `phone`, `name`, `address`) or holding an email address are removed, and a development warning names them. The same goes for the query string in `page_path` and `page_location`: it loses anything that looks personal or secret (`email`, `token`, `auth`, `session`, `code`, any value that contains an email address). `utm_*`, `gclid` and `fbclid` stay, and the `#fragment` is never sent. Pass `allowPii: true` to turn off the parameter filter.
- **`identify` sends nothing** unless you pass `sendUserId: true`, and traits are never sent.
- **A remote opened on its own** with `pnpm dev` in its folder has no shell, so its events wait for analytics to start and are dropped.
- **Adding env-t3 afterwards.** The key moves into the schema and the environment files. Delete `apps/shell/public/config/runtime-config.json`, or doctor reports it as missing `environment`.
- **A second provider.** `init.ts` starts GTM with `addProvider`, so another provider such as [analytics-clarity](/features/analytics-clarity) can run next to it. If your project predates `addProvider` and still has `initAnalytics(createGtmProvider(...))` in that file, change it to `addProvider(...)`, imported from `@mfeflow/analytics/providers`. Otherwise the provider that starts second is ignored.

## Reference

- [env-t3](/features/env-t3), where `gtmId` is declared and checked
- [analytics-clarity](/features/analytics-clarity), a second provider that waits for the same consent
- [Runtime config](/concepts/runtime-config)
- [`@mfeflow/analytics` README](https://github.com/mfeflow/mfeflow/tree/main/packages/analytics)
