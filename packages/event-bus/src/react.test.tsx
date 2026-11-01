import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureEvent, listenerCount, publish, resetEventBusForTests } from '.';
import { useEvent } from './react';

declare module '.' {
  interface EventMap {
    'shop.line-added.v1': { sku: string };
    'user.changed.v1': { user: string };
  }
}

beforeEach(resetEventBusForTests);
afterEach(cleanup);

/** A remote: counts what it hears and shows it. */
function Counter({ id }: { id: string }) {
  const [skus, setSkus] = useState<string[]>([]);
  useEvent('shop.line-added.v1', ({ sku }) => {
    setSkus((prev) => [...prev, sku]);
  });
  return <p data-testid={id}>{skus.join(',')}</p>;
}

describe('useEvent', () => {
  it('lets two remotes in one page hear the same event without importing each other', () => {
    render(
      <>
        <Counter id="catalog" />
        <Counter id="cart" />
      </>,
    );
    act(() => {
      publish('shop.line-added.v1', { sku: 'A1' });
    });
    expect(screen.getByTestId('catalog').textContent).toBe('A1');
    expect(screen.getByTestId('cart').textContent).toBe('A1');
  });

  it('delivers each event once under StrictMode, and leaves no listener after unmount', () => {
    const { unmount } = render(
      <StrictMode>
        <Counter id="cart" />
      </StrictMode>,
    );
    expect(listenerCount('shop.line-added.v1')).toBe(1);
    act(() => {
      publish('shop.line-added.v1', { sku: 'A1' });
    });
    expect(screen.getByTestId('cart').textContent).toBe('A1');
    unmount();
    expect(listenerCount('shop.line-added.v1')).toBe(0);
  });

  it('replays the last payload to a component that mounts late, once per mount', () => {
    configureEvent('user.changed.v1', { replay: true });
    publish('user.changed.v1', { user: 'jane' });
    const seen = vi.fn();
    function Late() {
      useEvent('user.changed.v1', seen);
      return null;
    }
    render(<Late />);
    expect(seen).toHaveBeenCalledExactlyOnceWith({ user: 'jane' });
    cleanup();
    seen.mockClear();
    render(
      <StrictMode>
        <Late />
      </StrictMode>,
    );
    expect(seen).toHaveBeenCalledTimes(2);
    expect(listenerCount('user.changed.v1')).toBe(1);
    seen.mockClear();
    act(() => {
      publish('user.changed.v1', { user: 'raj' });
    });
    expect(seen).toHaveBeenCalledExactlyOnceWith({ user: 'raj' });
  });

  it('can skip the replay', () => {
    configureEvent('user.changed.v1', { replay: true });
    publish('user.changed.v1', { user: 'jane' });
    const seen = vi.fn();
    function Late() {
      useEvent('user.changed.v1', seen, { replay: false });
      return null;
    }
    render(<Late />);
    expect(seen).not.toHaveBeenCalled();
  });

  it('calls the newest handler without resubscribing', () => {
    function Shows({ label }: { label: string }) {
      const [text, setText] = useState('');
      useEvent('shop.line-added.v1', ({ sku }) => {
        setText(`${label}:${sku}`);
      });
      return <p data-testid="out">{text}</p>;
    }
    const { rerender } = render(<Shows label="one" />);
    rerender(<Shows label="two" />);
    expect(listenerCount('shop.line-added.v1')).toBe(1);
    act(() => {
      publish('shop.line-added.v1', { sku: 'A1' });
    });
    expect(screen.getByTestId('out').textContent).toBe('two:A1');
  });
});
