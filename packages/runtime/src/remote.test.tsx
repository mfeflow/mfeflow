import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';

const loadRemote = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('@module-federation/enhanced/runtime', () => ({ loadRemote }));

const { RemoteBoundary, clearRemoteCacheForTests, remoteComponent } = await import('./remote.js');
const { REMOTE_ERROR_EVENT } = await import('./report.js');

function Cart() {
  return <p>cart works</p>;
}

function Exploding(): never {
  throw new Error('render failed');
}

function CustomFallback({ name }: { name: string }) {
  return <p>custom fallback for {name}</p>;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  clearRemoteCacheForTests();
  loadRemote.mockReset();
  globalThis.mfeflowReports = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RemoteBoundary', () => {
  it('renders the remote module', async () => {
    loadRemote.mockResolvedValue({ default: Cart });
    render(<RemoteBoundary id="cart/App" loading={<span>loading</span>} />);
    expect(await screen.findByText('cart works')).toBeTruthy();
    expect(loadRemote).toHaveBeenCalledWith('cart/App');
  });

  it('shows the fallback and reports when the manifest fails to load', async () => {
    loadRemote.mockRejectedValue(new Error('Failed to get manifest. #RUNTIME-003'));
    const seen: string[] = [];
    window.addEventListener(REMOTE_ERROR_EVENT, (e) => {
      if (e instanceof CustomEvent) seen.push(String(Reflect.get(Object(e.detail), 'mfe')));
    });
    render(<RemoteBoundary id="cart/App" />);
    expect((await screen.findByRole('alert')).textContent).toContain('cart is unavailable');
    expect(globalThis.mfeflowReports?.[0]).toMatchObject({ mfe: 'cart', where: 'load' });
    expect(seen).toContain('cart');
  });

  it('shows the fallback when the remote entry answers 404', async () => {
    loadRemote.mockRejectedValue(
      new Error('Failed to load script http://x/mfe/cart/remoteEntry.js: 404 #RUNTIME-008'),
    );
    render(<RemoteBoundary id="cart/App" />);
    expect((await screen.findByRole('alert')).textContent).toContain('cart is unavailable');
    expect(globalThis.mfeflowReports?.[0]).toMatchObject({ mfe: 'cart', where: 'load' });
    expect(globalThis.mfeflowReports?.[0]?.message).toMatch(/404/);
  });

  it('times out slow remotes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    loadRemote.mockReturnValue(new Promise(() => undefined));
    render(<RemoteBoundary id="slow/App" timeoutMs={50} fallback={CustomFallback} />);
    await vi.advanceTimersByTimeAsync(60);
    expect(await screen.findByText('custom fallback for slow')).toBeTruthy();
    expect(globalThis.mfeflowReports?.[0]?.message).toMatch(/timed out after 50 ms/);
  });

  it('catches render errors in the remote', async () => {
    loadRemote.mockResolvedValue({ default: Exploding });
    render(<RemoteBoundary id="account/App" />);
    expect((await screen.findByRole('alert')).textContent).toContain('account is unavailable');
    expect(globalThis.mfeflowReports?.some((r) => r.where === 'render')).toBe(true);
  });

  it('rejects modules without a default component', async () => {
    loadRemote.mockResolvedValue({ notDefault: true });
    render(<RemoteBoundary id="odd/App" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(globalThis.mfeflowReports?.[0]?.message).toMatch(/no default export/);
  });
});

describe('remoteComponent', () => {
  it('caches components per id and retries after a failure', async () => {
    loadRemote.mockResolvedValue({ default: Cart });
    const a: ComponentType = remoteComponent('cart/App');
    expect(remoteComponent('cart/App')).toBe(a);
    loadRemote.mockRejectedValueOnce(new Error('down'));
    const B = remoteComponent('down/App');
    render(<B />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(remoteComponent('down/App')).not.toBe(B);
  });
});
