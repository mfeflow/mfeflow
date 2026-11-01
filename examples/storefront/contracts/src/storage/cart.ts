/**
 * Where the cart keeps its items: the storage namespace and key. The catalog adds to the cart by
 * writing here, so an add is never lost to a mini cart that is still loading, or broken.
 */
export const cartItems = { mfe: 'cart', key: 'items' } as const;
