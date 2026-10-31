import { createTracker } from '@mfeflow/analytics';

declare module '@mfeflow/analytics' {
  interface AnalyticsEvents {
    catalog_viewed: undefined;
  }
}

export const tracker = createTracker('catalog', { events: ['catalog_viewed'] });
