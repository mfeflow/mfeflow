import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { EVENT_NAME } from '@mfeflow/contracts';
import {
  configureEvent,
  isEventName,
  listenerCount,
  publish,
  resetEventBusForTests,
  subscribe,
} from '.';

declare module '.' {
  interface EventMap {
    'cart.item-added.v1': { sku: string; qty: number };
    'cart.cleared.v1': undefined;
    'session.changed.v1': { user: string | null };
  }
}

beforeEach(resetEventBusForTests);
afterEach(() => {
  vi.restoreAllMocks();
});

describe('publish and subscribe', () => {
  it('delivers the payload to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe('cart.item-added.v1', a);
    subscribe('cart.item-added.v1', b);
    expect(publish('cart.item-added.v1', { sku: 'A1', qty: 2 })).toBe(true);
    expect(a).toHaveBeenCalledExactlyOnceWith({ sku: 'A1', qty: 2 });
    expect(b).toHaveBeenCalledExactlyOnceWith({ sku: 'A1', qty: 2 });
  });

  it('keeps events apart', () => {
    const added = vi.fn();
    subscribe('cart.item-added.v1', added);
    publish('cart.cleared.v1');
    expect(added).not.toHaveBeenCalled();
  });

  it('is fine to publish with nobody listening', () => {
    expect(publish('cart.cleared.v1')).toBe(true);
  });

  it('treats subscribing the same function twice as two subscriptions', () => {
    const handler = vi.fn();
    const first = subscribe('cart.cleared.v1', handler);
    const second = subscribe('cart.cleared.v1', handler);
    expect(listenerCount('cart.cleared.v1')).toBe(2);
    publish('cart.cleared.v1');
    expect(handler).toHaveBeenCalledTimes(2);
    first();
    first();
    expect(listenerCount('cart.cleared.v1')).toBe(1);
    publish('cart.cleared.v1');
    expect(handler).toHaveBeenCalledTimes(3);
    second();
    expect(listenerCount('cart.cleared.v1')).toBe(0);
  });

  it('stops after unsubscribe, and unsubscribing twice is harmless', () => {
    const handler = vi.fn();
    const stop = subscribe('cart.cleared.v1', handler);
    stop();
    stop();
    publish('cart.cleared.v1');
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves no listeners behind once everyone has unsubscribed', () => {
    const stops = Array.from({ length: 50 }, () => subscribe('cart.cleared.v1', () => undefined));
    expect(listenerCount('cart.cleared.v1')).toBe(50);
    for (const stop of stops) stop();
    expect(listenerCount('cart.cleared.v1')).toBe(0);
  });

  it('does not let a throwing handler stop the others, and reports it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    subscribe('cart.cleared.v1', () => {
      throw new Error('boom');
    });
    subscribe('cart.cleared.v1', after);
    expect(publish('cart.cleared.v1')).toBe(true);
    expect(after).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"cart.cleared.v1" threw'),
      expect.any(Error),
    );
  });

  it('skips a handler that was unsubscribed while an earlier one ran', () => {
    const second = vi.fn();
    let stopSecond = () => {};
    subscribe('cart.cleared.v1', () => {
      stopSecond();
    });
    stopSecond = subscribe('cart.cleared.v1', second);
    publish('cart.cleared.v1');
    expect(second).not.toHaveBeenCalled();
  });

  it('does not call a handler added while delivering until the next publish', () => {
    const late = vi.fn();
    subscribe('cart.cleared.v1', () => {
      subscribe('cart.cleared.v1', late);
    });
    publish('cart.cleared.v1');
    expect(late).not.toHaveBeenCalled();
    publish('cart.cleared.v1');
    expect(late).toHaveBeenCalledOnce();
  });

  it('lets a handler publish another event', () => {
    const cleared = vi.fn();
    subscribe('cart.item-added.v1', () => {
      publish('cart.cleared.v1');
    });
    subscribe('cart.cleared.v1', cleared);
    publish('cart.item-added.v1', { sku: 'A1', qty: 1 });
    expect(cleared).toHaveBeenCalledOnce();
  });
});

describe('typing', () => {
  it('checks names and payloads', () => {
    expectTypeOf(publish<'cart.item-added.v1'>).parameters.toEqualTypeOf<
      ['cart.item-added.v1', { sku: string; qty: number }]
    >();
    expectTypeOf(publish<'cart.cleared.v1'>).parameters.toEqualTypeOf<
      ['cart.cleared.v1', payload?: undefined]
    >();
    subscribe('session.changed.v1', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ user: string | null }>();
    })();
    // @ts-expect-error an unknown event
    publish('cart.removed.v1', {});
    // @ts-expect-error a payload of the wrong shape
    publish('cart.item-added.v1', { sku: 1, qty: 1 });
    // @ts-expect-error a missing payload
    publish('cart.item-added.v1');
    // @ts-expect-error an event without a payload takes none
    publish('cart.cleared.v1', { all: true });
  });
});

describe('replay', () => {
  it('hands the last payload to a late subscriber, for events that opt in', () => {
    configureEvent('session.changed.v1', { replay: true });
    publish('session.changed.v1', { user: 'a' });
    publish('session.changed.v1', { user: 'b' });
    const late = vi.fn();
    subscribe('session.changed.v1', late);
    expect(late).toHaveBeenCalledExactlyOnceWith({ user: 'b' });
    publish('session.changed.v1', { user: null });
    expect(late).toHaveBeenLastCalledWith({ user: null });
  });

  it('does not replay events that did not opt in', () => {
    publish('cart.item-added.v1', { sku: 'A1', qty: 1 });
    const late = vi.fn();
    subscribe('cart.item-added.v1', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('does not replay what was published before the event opted in', () => {
    publish('session.changed.v1', { user: 'a' });
    configureEvent('session.changed.v1', { replay: true });
    const late = vi.fn();
    subscribe('session.changed.v1', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('replays an event whose payload is undefined', () => {
    configureEvent('cart.cleared.v1', { replay: true });
    publish('cart.cleared.v1');
    const late = vi.fn();
    subscribe('cart.cleared.v1', late);
    expect(late).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('can be skipped by a subscriber', () => {
    configureEvent('session.changed.v1', { replay: true });
    publish('session.changed.v1', { user: 'a' });
    const late = vi.fn();
    subscribe('session.changed.v1', late, { replay: false });
    expect(late).not.toHaveBeenCalled();
  });

  it('forgets the payload when replay is turned off', () => {
    configureEvent('session.changed.v1', { replay: true });
    publish('session.changed.v1', { user: 'a' });
    configureEvent('session.changed.v1', { replay: false });
    configureEvent('session.changed.v1', { replay: true });
    const late = vi.fn();
    subscribe('session.changed.v1', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('does not stop a replaying handler from throwing into the subscriber', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureEvent('session.changed.v1', { replay: true });
    publish('session.changed.v1', { user: 'a' });
    const stop = subscribe('session.changed.v1', () => {
      throw new Error('boom');
    });
    expect(error).toHaveBeenCalledOnce();
    expect(listenerCount('session.changed.v1')).toBe(1);
    stop();
  });
});

describe('validation', () => {
  const isItem = (payload: unknown): { sku: string; qty: number } => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof Reflect.get(payload, 'sku') !== 'string'
    )
      throw new TypeError('sku must be text');
    return { sku: String(Reflect.get(payload, 'sku')), qty: Number(Reflect.get(payload, 'qty')) };
  };

  it('delivers what the validator returns', () => {
    configureEvent('cart.item-added.v1', { validate: isItem });
    const handler = vi.fn();
    subscribe('cart.item-added.v1', handler);
    expect(publish('cart.item-added.v1', { sku: 'A1', qty: 1 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ sku: 'A1', qty: 1 });
  });

  it('refuses a payload the validator throws on, tells nobody and keeps the payload out of the log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureEvent('cart.item-added.v1', { validate: isItem });
    const handler = vi.fn();
    subscribe('cart.item-added.v1', handler);
    // @ts-expect-error the wrong shape on purpose
    expect(publish('cart.item-added.v1', { sku: 42, secret: 'jane@example.com' })).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      '[mfeflow/event-bus] "cart.item-added.v1" was not sent: sku must be text',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('jane@example.com');
  });

  it('does not replay a refused payload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureEvent('cart.item-added.v1', { replay: true, validate: isItem });
    // @ts-expect-error the wrong shape on purpose
    publish('cart.item-added.v1', { sku: 1 });
    const late = vi.fn();
    subscribe('cart.item-added.v1', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('keeps the validator when a later call only sets replay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureEvent('cart.item-added.v1', { validate: isItem });
    configureEvent('cart.item-added.v1', { replay: true });
    // @ts-expect-error the wrong shape on purpose
    expect(publish('cart.item-added.v1', { sku: 1 })).toBe(false);
  });

  it('reports a thrown value that is not an Error with a plain reason', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureEvent('cart.cleared.v1', {
      validate: () => {
        // oxlint-disable-next-line only-throw-error -- a validator may throw anything
        throw 'no';
      },
    });
    expect(publish('cart.cleared.v1')).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid payload'));
  });
});

describe('event names', () => {
  it('follow the pattern mfe.json validates', () => {
    for (const name of [
      'cart.item-added.v1',
      'a.b.c.v3',
      'cart.updated',
      'Cart.x.v1',
      'cart.item_added@1',
    ]) {
      expect(isEventName(name), name).toBe(EVENT_NAME.test(name));
    }
  });

  it.each(['cart.item-added.v1', 'checkout.order-placed.v12', 'a.b.c.v3'])('accepts %s', (name) => {
    expect(isEventName(name)).toBe(true);
  });

  it.each(['cart.updated', 'cart.updated.v0', 'Cart.updated.v1', 'cart.updated@1', 'v1', ''])(
    'rejects "%s"',
    (name) => {
      expect(isEventName(name)).toBe(false);
    },
  );

  it('warns once in development about an unversioned name, and still works', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = vi.fn();
    // @ts-expect-error not in the map, and not versioned
    subscribe('cart.updated', handler);
    // @ts-expect-error not in the map, and not versioned
    publish('cart.updated', 1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('cart.item-added.v1');
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('stays quiet in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // @ts-expect-error not in the map, and not versioned
    publish('cart.updated');
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('two copies of the package on one page', () => {
  it('share subscribers, so a remote with its own copy still hears the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await import('.');
    first.listenerCount('cart.cleared.v1');
    expect(warn).not.toHaveBeenCalled();
    vi.resetModules();
    const second = await import('.');
    expect(second.publish).not.toBe(first.publish);
    const heard = vi.fn();
    first.subscribe('cart.cleared.v1', heard);
    second.publish('cart.cleared.v1');
    expect(heard).toHaveBeenCalledOnce();
    expect(second.listenerCount('cart.cleared.v1')).toBe(1);
  });

  it('warn once in development that a second copy is loaded, and stay quiet in production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await import('.');
    first.listenerCount('cart.cleared.v1');
    vi.resetModules();
    const second = await import('.');
    second.listenerCount('cart.cleared.v1');
    second.publish('cart.cleared.v1');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('two copies of @mfeflow/event-bus');
    expect(warn.mock.calls[0]?.[0]).toContain('singleton');

    first.resetEventBusForTests();
    warn.mockClear();
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const third = await import('.');
    third.listenerCount('cart.cleared.v1');
    vi.resetModules();
    const fourth = await import('.');
    fourth.listenerCount('cart.cleared.v1');
    vi.unstubAllEnvs();
    expect(warn).not.toHaveBeenCalled();
  });
});
