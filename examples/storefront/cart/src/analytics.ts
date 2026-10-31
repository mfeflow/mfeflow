import { createTracker } from '@mfeflow/analytics';

declare module '@mfeflow/analytics' {
  interface AnalyticsEvents {
    cart_viewed: undefined;
    mini_cart_viewed: undefined;
  }
}

export const tracker = createTracker('cart', { events: ['cart_viewed', 'mini_cart_viewed'] });
