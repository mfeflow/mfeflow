/**
 * What the storefront's micro-frontends say to each other, by versioned name. Types only.
 */
export interface Events {
  /** A visitor added a product to the cart. Catalog publishes it; the cart and the shell listen. */
  'cart.item-added.v1': { sku: string };
}
