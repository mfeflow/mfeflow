import { useEvent } from '@mfeflow/event-bus/react';
import type { Events } from '@storefront/contracts/events';

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges the contracts into the platform map
  interface EventMap extends Events {}
}

/** Calls `handler` with the sku of every product a visitor adds, wherever on the page the button is. */
export function useItemAdded(handler: (sku: string) => void): void {
  useEvent('cart.item-added.v1', ({ sku }) => {
    handler(sku);
  });
}
