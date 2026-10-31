import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '.';

const isTheme = (v: unknown): v is 'light' | 'dark' => v === 'light' || v === 'dark';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('createStorage', () => {
  it('prefixes keys with the micro-frontend name', () => {
    const cart = createStorage('cart');
    cart.set('items', [1, 2]);
    expect(localStorage.getItem('cart:items')).toBe('[1,2]');
    expect(cart.get('items', [0])).toEqual([1, 2]);
  });

  it('keeps two remotes using the same key apart', () => {
    const cart = createStorage('cart');
    const catalog = createStorage('catalog');
    cart.set('filters', { a: 1 });
    catalog.set('filters', { b: 2 });
    expect(cart.read('filters')).toEqual({ a: 1 });
    expect(catalog.read('filters')).toEqual({ b: 2 });
    expect(cart.keys()).toEqual(['filters']);
  });

  it('returns the fallback for missing or corrupt values', () => {
    const s = createStorage('shell');
    expect(s.read('missing')).toBeUndefined();
    expect(s.get('missing', 'dark')).toBe('dark');
    localStorage.setItem('shell:broken', '{not json');
    expect(s.get('broken', 'base')).toBe('base');
    s.set('n', 5);
    expect(s.get('n', 'text')).toBe('text');
    expect(s.get('n', [1])).toEqual([1]);
  });

  it('validates with a guard and keeps references stable', () => {
    const s = createStorage('shell');
    s.set('theme', 'neon');
    expect(s.get('theme', 'light', isTheme)).toBe('light');
    s.set('theme', 'dark');
    expect(s.get('theme', 'light', isTheme)).toBe('dark');
    s.set('obj', { a: 1 });
    expect(s.read('obj')).toBe(s.read('obj'));
  });

  it('removes values', () => {
    const s = createStorage('shell');
    s.set('theme', 'dark');
    s.remove('theme');
    expect(s.read('theme')).toBeUndefined();
  });

  it('uses sessionStorage and memory areas', () => {
    createStorage('shell', { area: 'session' }).set('x', 1);
    expect(sessionStorage.getItem('shell:x')).toBe('1');
    const mem = createStorage('shell', { area: 'memory' });
    mem.set('y', 2);
    expect(mem.read('y')).toBe(2);
    expect(localStorage.getItem('shell:y')).toBeNull();
  });

  it('rejects invalid micro-frontend names', () => {
    expect(() => createStorage('bad name')).toThrow(/invalid micro-frontend name/);
    expect(() => createStorage('')).toThrow();
  });

  it('notifies subscribers in this tab and stops after unsubscribe', () => {
    const s = createStorage('shell');
    const listener = vi.fn();
    const off = s.subscribe('theme', listener);
    s.set('theme', 'dark');
    s.remove('theme');
    off();
    s.set('theme', 'base');
    expect(listener.mock.calls).toEqual([['dark'], [undefined]]);
  });

  it('keeps separate instances for the same micro-frontend in sync', () => {
    const a = createStorage('cart');
    const b = createStorage('cart');
    const listener = vi.fn();
    const off = b.subscribe('count', listener);
    a.set('count', 3);
    off();
    off();
    expect(listener).toHaveBeenCalledWith(3);
  });

  it('notifies subscribers about changes from other tabs, for its own keys only', () => {
    const s = createStorage('shell');
    const listener = vi.fn();
    const off = s.subscribe('theme', listener);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'shell:theme',
        newValue: '"dark"',
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cart:theme',
        newValue: '"x"',
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'shell:theme',
        newValue: '"y"',
        storageArea: sessionStorage,
      }),
    );
    off();
    expect(listener.mock.calls).toEqual([['dark']]);
  });

  it('keeps working when the backend throws on write', () => {
    const backend = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } satisfies Storage;
    const s = createStorage('shell', { backend });
    const listener = vi.fn();
    s.subscribe('k', listener);
    expect(() => s.set('k', 1)).not.toThrow();
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('falls back to memory when localStorage is unavailable', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const s = createStorage('shell');
    s.set('a', 1);
    expect(s.read('a')).toBe(1);
    spy.mockRestore();
  });
});
