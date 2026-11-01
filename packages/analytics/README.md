# @mfeflow/analytics

Analytics for micro-frontends behind one provider interface. The shell starts it once; remotes only send events. Ships a Google Tag Manager provider with Consent Mode v2, a typed event map each remote extends, a tracker that stamps `mfe_name` and `mfe_version`, and React bindings.

## Install

```sh
pnpm add @mfeflow/analytics
```

`react` (19) is an optional peer dependency, needed only for `@mfeflow/analytics/react`. In a project made with mfeflow, `mfeflow add analytics-gtm` does all of this.

## Usage

```ts
// shell, once
import { initAnalytics } from '@mfeflow/analytics';
import { createGtmProvider } from '@mfeflow/analytics/gtm';

initAnalytics(createGtmProvider({ containerId: 'GTM-ABC123' }));
```

```ts
// a remote
import { createTracker } from '@mfeflow/analytics';

declare module '@mfeflow/analytics' {
  interface AnalyticsEvents {
    add_to_cart: { sku: string };
  }
}

export const tracker = createTracker('cart', { events: ['add_to_cart'] });
tracker.track('add_to_cart', { sku: 'A1' });
```

The GTM provider pushes the four consent signals as `denied` to `dataLayer` before it requests `gtm.js`, and drops parameters that look like personal data.

## Module Federation sharing

Bucket: **singleton**. Share `@mfeflow/analytics` and `@mfeflow/analytics/react` (`@mfeflow/rsbuild` does). State also lives on `globalThis`, so a second copy still talks to the one provider. `@mfeflow/analytics/gtm` is imported by the shell only.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
