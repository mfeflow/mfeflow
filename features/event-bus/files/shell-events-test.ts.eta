import { publish, resetEventBusForTests, subscribe } from '@mfeflow/event-bus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureShellEvents } from './events';

afterEach(resetEventBusForTests);

describe('the shell event bus', () => {
  it('carries the contracts events between remotes', () => {
    const heard = vi.fn();
    subscribe('mfe.ready.v1', heard);
    publish('mfe.ready.v1', { mfe: 'cart' });
    expect(heard).toHaveBeenCalledExactlyOnceWith({ mfe: 'cart' });
  });

  it('replays the latest announcement to a remote that mounts late', () => {
    configureShellEvents();
    publish('mfe.ready.v1', { mfe: 'cart' });
    const late = vi.fn();
    subscribe('mfe.ready.v1', late);
    expect(late).toHaveBeenCalledExactlyOnceWith({ mfe: 'cart' });
  });
});
