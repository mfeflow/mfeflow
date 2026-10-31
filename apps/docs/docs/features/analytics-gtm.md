# analytics-gtm

Google Tag Manager with Consent Mode v2 behind `@mfeflow/analytics`. Off by default.

```sh
mfeflow add analytics-gtm
```

Set the container in the runtime config and the shell does the rest:

```json
// apps/shell/public/config/runtime-config.prod.json
{ "environment": "prod", "gtmId": "GTM-ABC123" }
```

An empty `gtmId` (the default) keeps analytics off: no script is loaded and every tracker call is dropped.

## What you get

| File                                         | What it is for                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/shell/src/analytics/init.ts`           | The boot step. Reads `gtmId` from the runtime config and starts the GTM provider. It does not hold up first render.         |
| `apps/shell/src/analytics/Analytics.tsx`     | Wraps the shell's `App`: page views on route changes, and the consent banner.                                               |
| `apps/shell/src/analytics/ConsentBanner.tsx` | A minimal, unstyled banner on `useConsent()`: Accept analytics, Accept analytics and advertising, Reject. Yours to restyle. |
| `apps/<remote>/src/analytics.ts`             | The remote's events (declaration merging) and its tracker.                                                                  |

`@mfeflow/analytics` is a singleton: the shell starts it, remotes only use it. A remote that is opened on its own
(`pnpm dev` in its folder) has no shell, so its events wait for analytics to start and are dropped.

## Consent Mode v2

`createGtmProvider` pushes the four signals to `dataLayer`, all `denied`, with `wait_for_update`, **before** it adds the
`gtm.js` script, and it pushes them as the `arguments` object that GTM understands (an array is ignored).

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

The visitor's choice is stored in `localStorage` (`mfeflow:consent`) and sent as a consent update right after the
defaults on the next visit, still before `gtm.js` is requested.

The generated banner grants only what its button says: **Accept analytics** grants `analytics_storage` and keeps the
three `ad_*` signals denied; the `ad_*` signals are granted only by **Accept analytics and advertising**. Whatever you
change, keep the wording in line with what the button grants.

```tsx
import { useConsent } from '@mfeflow/analytics/react';

const { decided, acceptAll, rejectAll, update, consent } = useConsent();
update({ analytics_storage: 'granted' }); // one signal at a time
```

## Events

Each remote declares what it sends. TypeScript checks the name and the parameters:

```ts
// apps/cart/src/analytics.ts
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

```tsx
import { useTrackOnMount } from '@mfeflow/analytics/react';
import { tracker } from '../analytics';

useTrackOnMount(tracker, 'cart_viewed'); // once per mount, also under StrictMode
tracker.track('add_to_cart', { sku, qty });
```

Every event carries `mfe: { name: 'cart' }`. In GTM that is the Data Layer Variable `mfe.name`.

In development, `events` turns on a validator: a name the tracker did not declare, or one GA4 would reject (letters,
digits and underscores, starting with a letter, at most 40 characters), logs a warning once. Production builds stay
quiet. In tests, `createRecordingProvider()` records every call and `noopProvider` drops them.

## Page views

`<Analytics>` sends `page_view` (`page_path`, `page_location`, `page_title`) for the first page and after every
`pushState`, `replaceState`, back/forward and hash changes, whatever router the shell uses. The same path and query is
never sent twice in a row.

- `page_path` and `page_location` include the query string, minus anything that looks like personal data or a secret
  (`email`, `phone`, `name`, `token`, `auth`, `session`, `code`, any value that contains an email address). `utm_*`,
  `gclid` and `fbclid` are kept. The `#fragment` is never sent.
- A hash router (`/#/catalog?x=1`) is followed: the hash route goes into the path the same way.
- `page_title` is read after the route has rendered: as soon as `document.title` changes after the navigation, or 300
  ms later if the page keeps one title. A page view for a navigation can therefore reach the data layer a moment
  after the event that triggered it.

Turn off the automatic page view in your GA4 configuration tag, or every page is counted twice.

## No personal data by default

- Parameters named like personal data (`email`, `phone`, `name`, `address`, …) or holding an email address are
  dropped, and a development warning names them. `createGtmProvider({ allowPii: true })` turns that off.
- `identify` sends nothing unless `createGtmProvider({ sendUserId: true })`; traits are never sent.

## Runtime config

|                  | `gtmId`                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| With `env-t3`    | Added to the schema and to every `runtime-config.<env>.json`, whichever feature was added first. |
| Without `env-t3` | Added to `apps/shell/public/config/runtime-config.json`, which the shell fetches as it is.       |

The value must be empty or match `GTM-` followed by letters and digits; `pnpm check:runtime-config` checks it.

Adding `env-t3` to a project that already has `analytics-gtm` writes the key into the schema and the environment
files too. Delete `apps/shell/public/config/runtime-config.json` then: the per-environment files replace it, and
`mfeflow doctor` reports it as missing `environment` until it is gone.
