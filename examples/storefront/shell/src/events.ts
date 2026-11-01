import { useState } from 'react';
import { configureEvent } from '@mfeflow/event-bus';
import { useEvent } from '@mfeflow/event-bus/react';
import type { Events } from '@storefront/contracts/events';

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges the contracts into the platform map
  interface EventMap extends Events {}
}

function itemAdded(payload: unknown): Events['cart.item-added.v1'] {
  const sku: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'sku') : undefined;
  if (typeof sku !== 'string' || sku === '') throw new TypeError('sku must be a non-empty string');
  return { sku };
}

/**
 * Sets how the platform's events behave, once at boot. A remote built last week can publish what
 * today's types do not allow, so the shell checks the one event every remote hears. Importing the
 * bus here also makes the shell the one that provides the copy the remotes share.
 */
export function configureShellEvents(): void {
  configureEvent('cart.item-added.v1', { validate: itemAdded });
}

/** The sku of the product most recently added to the cart, from any remote. */
export function useLastAdded(): string | undefined {
  const [sku, setSku] = useState<string | undefined>();
  useEvent('cart.item-added.v1', (added) => {
    setSku(added.sku);
  });
  return sku;
}
