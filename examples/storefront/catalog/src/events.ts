import { publish } from '@mfeflow/event-bus';
import { createStorage } from '@mfeflow/storage';
import type { Events } from '@storefront/contracts/events';
import { cartItems } from '@storefront/contracts/storage/cart';

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges the contracts into the platform map
  interface EventMap extends Events {}
}

const cart = createStorage(cartItems.mfe);

const isItems = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Puts a product in the cart, then tells whoever is listening. The cart is written here, by the
 * publisher, so the add survives a mini cart that has not loaded; the mini cart shows it from storage.
 */
export function addToCart(sku: string): void {
  cart.set(cartItems.key, [...cart.get<string[]>(cartItems.key, [], isItems), sku]);
  publish('cart.item-added.v1', { sku });
}
