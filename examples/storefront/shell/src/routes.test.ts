import { describe, expect, it } from 'vitest';
import { links, remoteFor } from './routes';

describe('the shell routes', () => {
  it('link to each remote under its mount', () => {
    expect(links.href('catalog.home')).toBe('/catalog');
    expect(links.href('cart.home')).toBe('/cart');
  });

  it('send a path to the remote that serves it, and the front page to the catalog', () => {
    expect(remoteFor('/cart')).toBe('cart');
    expect(remoteFor('/cart/checkout')).toBe('cart');
    expect(remoteFor('/catalog')).toBe('catalog');
    expect(remoteFor('/')).toBe('catalog');
    expect(remoteFor('/cartoon')).toBe('catalog');
  });
});
