import { describe, expect, it } from 'vitest';
import { routesOverlap } from './routes';

describe('routesOverlap', () => {
  it.each([
    ['/cart', '/cart'],
    ['/cart', '/cart/'],
    ['/Cart', '/cart'],
    ['/', '/'],
    ['/checkout/*', '/checkout/pay'],
    ['/checkout/*', '/checkout'],
    ['/checkout/*', '/checkout/'],
    ['/checkout/*', '/checkout/pay/now'],
    ['/checkout/*', '/CHECKOUT/Pay'],
    ['/checkout/*', '/checkout/*'],
    ['/checkout/*', '/checkout/pay/*'],
    ['/checkout*', '/checkout'],
    ['/checkout*', '/checkout-v2/pay'],
    ['/*', '/'],
    ['/*', '/anything/at/all'],
    ['*', '/cart'],
    ['/p/:id', '/p/42'],
    ['/p/:id', '/p/:slug'],
    ['/p/:id', '/p/:id/'],
    ['/p/:id/edit', '/p/42/edit'],
    ['/p/:id', '/p/*'],
    ['/:section/new', '/cart/*'],
    ['/:a/b', '/x/:c'],
    ['/a/b*', '/a/bc/d'],
    ['/:rest*', '/foo'],
    ['/:rest*', '/'],
    ['/a/*/c', '/a/b/c'],
    ['/a/x*/c', '/a/xy/c'],
  ])('%s and %s overlap', (a, b) => {
    expect(routesOverlap(a, b)).toBe(true);
    expect(routesOverlap(b, a)).toBe(true);
  });

  it.each([
    ['/cart', '/catalog'],
    ['/a/*/c', '/a/b/d'],
    ['/a/*/c', '/a/b/c/d'],
    ['/a/x*/c', '/a/y/c'],
    ['/cart', '/cart/pay'],
    ['/cart/', '/cart/pay'],
    ['/', '/cart'],
    ['/checkout/*', '/cart'],
    ['/checkout/*', '/checkouts'],
    ['/checkout/*', '/'],
    ['/checkout*', '/cart/checkout'],
    ['/p/:id', '/p'],
    ['/p/:id', '/q/42'],
    ['/p/:id', '/p/42/edit'],
    ['/p/:id/edit', '/p/42/view'],
    ['/a/b*', '/a'],
    ['/a/b*', '/a/c/d/e'],
  ])('%s and %s do not overlap', (a, b) => {
    expect(routesOverlap(a, b)).toBe(false);
    expect(routesOverlap(b, a)).toBe(false);
  });
});
