import { publish, resetEventBusForTests, subscribe } from '@mfeflow/event-bus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureShellEvents } from './events';

afterEach(() => {
  resetEventBusForTests();
  vi.restoreAllMocks();
});

describe('the shell events', () => {
  it('pass a well-formed cart event on', () => {
    configureShellEvents();
    const heard = vi.fn();
    subscribe('cart.item-added.v1', heard);
    expect(publish('cart.item-added.v1', { sku: '2' })).toBe(true);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ sku: '2' });
  });

  it('stop one that an older or broken remote sent, without reaching the cart', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureShellEvents();
    const heard = vi.fn();
    subscribe('cart.item-added.v1', heard);
    // @ts-expect-error the wrong shape on purpose
    expect(publish('cart.item-added.v1', { sku: 42 })).toBe(false);
    expect(publish('cart.item-added.v1', { sku: '' })).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  });
});
