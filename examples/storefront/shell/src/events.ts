import { useState } from 'react';
import { useEvent } from '@mfeflow/event-bus/react';
import type { Events } from '@storefront/contracts/events';

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges the contracts into the platform map
  interface EventMap extends Events {}
}

/** The sku of the product most recently added to the cart, from any remote. */
export function useLastAdded(): string | undefined {
  const [sku, setSku] = useState<string | undefined>();
  useEvent('cart.item-added.v1', (added) => {
    setSku(added.sku);
  });
  return sku;
}
