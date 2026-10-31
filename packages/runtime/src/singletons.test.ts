import { afterEach, describe, expect, it } from 'vitest';
import { checkSingletons } from './singletons.js';

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__FEDERATION__');
});

function setShare(share: unknown): void {
  Reflect.set(globalThis, '__FEDERATION__', { __SHARE__: share });
}

describe('checkSingletons', () => {
  it('finds missing and duplicated singletons', () => {
    setShare({
      'shell:local': {
        default: {
          react: { '19.3.1': { loaded: true } },
          'react-dom': { '19.3.1': { loaded: true }, '19.2.0': { lib: () => undefined } },
        },
      },
      'cart:local': { default: { react: { '19.3.1': { loaded: true } } } },
    });
    expect(checkSingletons(['react', 'react-dom', '@mfeflow/theme'])).toEqual({
      missing: ['@mfeflow/theme'],
      duplicated: ['react-dom'],
    });
  });

  it('reports everything missing when Module Federation is not on the page', () => {
    expect(checkSingletons(['react'])).toEqual({ missing: ['react'], duplicated: [] });
    Reflect.set(globalThis, '__FEDERATION__', { __SHARE__: 'nope' });
    expect(checkSingletons(['react']).missing).toEqual(['react']);
  });
});
