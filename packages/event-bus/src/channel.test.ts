import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_EVENT } from './channel';
import { resetEventBusForTests, type EventMap } from '.';

declare module '.' {
  interface EventMap {
    'chat.said.v1': { text: string };
  }
}

type Bus = typeof import('.');

const KEY = Symbol.for('mfeflow.event-bus');

/** A copy of the package that loaded after an unreadable registry was already on the page. */
async function isolatedCopy(): Promise<Bus> {
  vi.resetModules();
  return import('.');
}

beforeEach(() => {
  resetEventBusForTests();
  Reflect.set(globalThis, KEY, { protocol: 99 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  resetEventBusForTests();
  vi.restoreAllMocks();
});

describe('a registry this copy cannot read', () => {
  it('warns in development and keeps this copy working on its own', async () => {
    const bus = await isolatedCopy();
    const heard = vi.fn();
    bus.subscribe('chat.said.v1', heard);
    bus.publish('chat.said.v1', { text: 'hi' });
    expect(heard).toHaveBeenCalledExactlyOnceWith({ text: 'hi' });
    expect(console.warn).toHaveBeenCalledOnce();
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('different protocol');
    expect(Reflect.get(globalThis, KEY)).toEqual({ protocol: 99 });
  });

  it('reaches the other isolated copies through a window event', async () => {
    const a = await isolatedCopy();
    const b = await isolatedCopy();
    const heardByB = vi.fn();
    const heardByA = vi.fn();
    a.subscribe('chat.said.v1', heardByA);
    b.subscribe('chat.said.v1', heardByB);
    a.publish('chat.said.v1', { text: 'hello' });
    expect(heardByB).toHaveBeenCalledExactlyOnceWith({ text: 'hello' });
    expect(heardByA).toHaveBeenCalledExactlyOnceWith({ text: 'hello' });
  });

  it('replays what another copy published, for events that replay', async () => {
    const a = await isolatedCopy();
    const b = await isolatedCopy();
    a.configureEvent('chat.said.v1', { replay: true });
    b.configureEvent('chat.said.v1', { replay: true });
    b.subscribe('chat.said.v1', () => undefined);
    a.publish('chat.said.v1', { text: 'earlier' });
    const late = vi.fn();
    b.subscribe('chat.said.v1', late);
    expect(late).toHaveBeenCalledExactlyOnceWith({ text: 'earlier' });
  });

  it('ignores window events that are not bus messages', async () => {
    const a = await isolatedCopy();
    const heard = vi.fn();
    a.subscribe('chat.said.v1', heard);
    window.dispatchEvent(new CustomEvent(CHANNEL_EVENT, { detail: 'nope' }));
    window.dispatchEvent(new Event(CHANNEL_EVENT));
    expect(heard).not.toHaveBeenCalled();
  });

  it('does not deliver twice to a copy that both sent and could hear its own message', async () => {
    const a = await isolatedCopy();
    const heard = vi.fn();
    a.subscribe('chat.said.v1', heard);
    a.publish('chat.said.v1', { text: 'once' });
    expect(heard).toHaveBeenCalledOnce();
  });

  it('delivers once to copies that share a registry, though they also hear each other over the window', async () => {
    resetEventBusForTests();
    vi.resetModules();
    const a = await import('.');
    vi.resetModules();
    const b = await import('.');
    const heardByA = vi.fn();
    const heardByB = vi.fn();
    a.subscribe('chat.said.v1', heardByA);
    b.subscribe('chat.said.v1', heardByB);
    a.publish('chat.said.v1', { text: 'once' });
    b.publish('chat.said.v1', { text: 'twice' });
    expect(heardByA.mock.calls).toEqual([[{ text: 'once' }], [{ text: 'twice' }]]);
    expect(heardByB.mock.calls).toEqual([[{ text: 'once' }], [{ text: 'twice' }]]);
  });
});

describe('an isolated copy and the copies that share the main registry', () => {
  /** One copy on the main registry, then one that finds a registry it cannot read. */
  async function mainAndIsolated(): Promise<{ main: Bus; isolated: Bus }> {
    Reflect.deleteProperty(globalThis, KEY);
    vi.resetModules();
    const main = await import('.');
    main.listenerCount('chat.said.v1');
    const shared: unknown = Reflect.get(globalThis, KEY);
    Reflect.set(globalThis, KEY, { protocol: 99 });
    vi.resetModules();
    const isolated = await import('.');
    isolated.listenerCount('chat.said.v1');
    Reflect.set(globalThis, KEY, shared);
    return { main, isolated };
  }

  it('hear each other, in both directions', async () => {
    const { main, isolated } = await mainAndIsolated();
    const heardByMain = vi.fn();
    const heardByIsolated = vi.fn();
    main.subscribe('chat.said.v1', heardByMain);
    isolated.subscribe('chat.said.v1', heardByIsolated);
    isolated.publish('chat.said.v1', { text: 'to main' });
    expect(heardByMain).toHaveBeenCalledExactlyOnceWith({ text: 'to main' });
    expect(heardByIsolated).toHaveBeenCalledExactlyOnceWith({ text: 'to main' });
    main.publish('chat.said.v1', { text: 'to isolated' });
    expect(heardByIsolated).toHaveBeenLastCalledWith({ text: 'to isolated' });
    expect(heardByIsolated).toHaveBeenCalledTimes(2);
    expect(heardByMain).toHaveBeenCalledTimes(2);
  });

  it('run the receiving copy’s own validator on what arrives over the window', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { main, isolated } = await mainAndIsolated();
    main.configureEvent('chat.said.v1', {
      validate: (payload) => {
        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('text' in payload) ||
          payload.text === 'bad'
        )
          throw new TypeError('no bad words');
        return { text: String(payload.text) };
      },
    });
    const heard = vi.fn();
    main.subscribe('chat.said.v1', heard);
    isolated.publish('chat.said.v1', { text: 'bad' });
    expect(heard).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('was not delivered: no bad words'));
    isolated.publish('chat.said.v1', { text: 'fine' });
    expect(heard).toHaveBeenCalledExactlyOnceWith({ text: 'fine' });
  });
});

describe('type', () => {
  it('keeps the map readable from here', () => {
    const text: EventMap['chat.said.v1']['text'] = 'ok';
    expect(text).toBe('ok');
  });
});
