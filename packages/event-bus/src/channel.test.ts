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

  it('stays out of the way of copies that share the registry', async () => {
    resetEventBusForTests();
    vi.resetModules();
    const bus = await import('.');
    const onWindow = vi.fn();
    window.addEventListener(CHANNEL_EVENT, onWindow);
    bus.publish('chat.said.v1', { text: 'quiet' });
    window.removeEventListener(CHANNEL_EVENT, onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });
});

describe('type', () => {
  it('keeps the map readable from here', () => {
    const text: EventMap['chat.said.v1']['text'] = 'ok';
    expect(text).toBe('ok');
  });
});
