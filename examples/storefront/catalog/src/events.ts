import { publish } from '@mfeflow/event-bus';
import type { Events } from '@storefront/contracts/events';

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges the contracts into the platform map
  interface EventMap extends Events {}
}

/** Tells the cart, and anyone else listening, that a product was added. */
export function addToCart(sku: string): void {
  publish('cart.item-added.v1', { sku });
}
