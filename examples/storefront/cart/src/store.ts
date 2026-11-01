import { createStorage } from '@mfeflow/storage';
import { cartItems } from '@storefront/contracts/storage/cart';

// One storage per remote. MiniCart and the cart page share it, so they stay in sync.
export const cartStorage = createStorage(cartItems.mfe);

export function isItems(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
