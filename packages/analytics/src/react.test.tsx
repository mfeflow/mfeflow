import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecordingProvider,
  initAnalytics,
  resetAnalyticsForTests,
  resetWarningsForTests,
  type RecordedCall,
} from '.';
import { createGtmProvider } from './gtm';
import { AnalyticsProvider, useConsent, useTrackOnMount, useTracker } from './react';

declare module '.' {
  interface AnalyticsEvents {
    cart_opened: undefined;
    catalog_opened: undefined;
  }
}

let calls: RecordedCall[] = [];

beforeEach(() => {
  resetAnalyticsForTests();
  resetWarningsForTests();
  history.replaceState(null, '', '/');
  const provider = createRecordingProvider();
  initAnalytics(provider);
  calls = provider.calls;
});
afterEach(() => {
  cleanup();
  resetAnalyticsForTests();
});

const types = (type: string) => calls.filter((c) => c.type === type);

function Remote({ name, event }: { name: string; event: 'cart_opened' | 'catalog_opened' }) {
  const tracker = useTracker(name);
  useTrackOnMount(tracker, event);
  return <p>{name}</p>;
}

describe('AnalyticsProvider', () => {
  it('sends page_view for the first page and each navigation', () => {
    render(
      <AnalyticsProvider>
        <p>shell</p>
      </AnalyticsProvider>,
    );
    expect(types('page')).toMatchObject([{ path: '/' }]);
    act(() => {
      history.pushState(null, '', '/catalog');
    });
    act(() => {
      history.pushState(null, '', '/catalog');
    });
    expect(types('page').map((c) => (c as { path: string }).path)).toEqual(['/', '/catalog']);
  });

  it('can leave page views off', () => {
    render(
      <AnalyticsProvider pageViews={false}>
        <p>shell</p>
      </AnalyticsProvider>,
    );
    expect(types('page')).toEqual([]);
  });

  it('under StrictMode with two remotes: one page_view, one event each, one gtm.js', () => {
    Reflect.deleteProperty(globalThis, 'dataLayer');
    document.head.innerHTML = '';
    resetAnalyticsForTests();
    const gtm = createGtmProvider({ containerId: 'GTM-ABC123' });
    initAnalytics(gtm);
    initAnalytics(createGtmProvider({ containerId: 'GTM-ABC123' }));
    render(
      <StrictMode>
        <AnalyticsProvider>
          <Remote name="catalog" event="catalog_opened" />
          <Remote name="cart" event="cart_opened" />
        </AnalyticsProvider>
      </StrictMode>,
    );
    const layer = Reflect.get(globalThis, 'dataLayer') as { event?: string }[];
    const named = (event: string) => layer.filter((e) => e.event === event);
    expect(named('page_view')).toHaveLength(1);
    expect(named('catalog_opened')).toHaveLength(1);
    expect(named('cart_opened')).toHaveLength(1);
    expect(document.querySelectorAll('script[src*="gtm.js"]')).toHaveLength(1);
    Reflect.deleteProperty(globalThis, 'dataLayer');
  });
});

describe('useTracker', () => {
  it('returns the same tracker on every render', () => {
    const seen = new Set<unknown>();
    function Probe() {
      seen.add(useTracker('cart', { events: [] }));
      return null;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    expect(seen.size).toBe(1);
  });

  it('warns once when there is no provider above it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Remote name="cart" event="cart_opened" />);
    render(<Remote name="cart" event="cart_opened" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no <AnalyticsProvider>');
    warn.mockRestore();
  });

  it('does not warn under the provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <AnalyticsProvider pageViews={false}>
        <Remote name="cart" event="cart_opened" />
      </AnalyticsProvider>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('useConsent', () => {
  function Banner() {
    const api = useConsent();
    return (
      <div>
        <span data-testid="state">{api.decided ? JSON.stringify(api.consent) : 'undecided'}</span>
        <button type="button" onClick={api.acceptAll}>
          accept
        </button>
        <button type="button" onClick={api.rejectAll}>
          reject
        </button>
        <button
          type="button"
          onClick={() => {
            api.update({ analytics_storage: 'granted' });
          }}
        >
          analytics
        </button>
      </div>
    );
  }

  it('is undecided until the visitor chooses, then follows the choice', () => {
    render(<Banner />);
    expect(screen.getByTestId('state').textContent).toBe('undecided');
    act(() => screen.getByText('analytics').click());
    expect(screen.getByTestId('state').textContent).toBe('{"analytics_storage":"granted"}');
    act(() => screen.getByText('reject').click());
    expect(screen.getByTestId('state').textContent).toContain('"ad_storage":"denied"');
    act(() => screen.getByText('accept').click());
    expect(screen.getByTestId('state').textContent).toContain('"ad_personalization":"granted"');
    expect(types('consent')).toHaveLength(3);
  });
});
