import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registerRemotes = vi.fn();
vi.mock('@module-federation/enhanced/runtime', () => ({ registerRemotes }));

const { DevOverlay } = await import('./overlay');
const { registerRemotesFromIndex } = await import('./registry');
const { reportRemoteError } = await import('./report');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  registerRemotesFromIndex({
    remotes: [
      { name: 'cart', entry: 'https://cdn.example.com/cart/mf-manifest.json', version: '1.2.0' },
      { name: 'catalog', entry: 'http://localhost:4311/mf-manifest.json', version: 'override' },
    ],
  });
});

afterEach(() => {
  cleanup();
  globalThis.mfeflowReports = undefined;
  vi.restoreAllMocks();
});

describe('DevOverlay', () => {
  it('renders nothing when disabled or closed', () => {
    const disabled = render(<DevOverlay enabled={false} open />);
    expect(disabled.container.innerHTML).toBe('');
    disabled.unmount();
    const closed = render(<DevOverlay enabled />);
    expect(closed.container.innerHTML).toBe('');
  });

  it('lists registered remotes, marks overrides, and toggles with Alt+Shift+M', () => {
    render(<DevOverlay enabled />);
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyM', altKey: true, shiftKey: true });
    });
    const overlay = screen.getByLabelText('mfeflow dev overlay');
    expect(overlay.textContent).toContain('2 remotes');
    expect(overlay.textContent).toContain('cart 1.2.0');
    expect(overlay.textContent).toContain('catalog override (override)');
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyM', altKey: true, shiftKey: true });
    });
    expect(screen.queryByLabelText('mfeflow dev overlay')).toBeNull();
  });

  it('shows remote errors as they are reported', () => {
    render(<DevOverlay enabled open />);
    act(() => {
      reportRemoteError('cart', 'load', new Error('timed out after 5000 ms'));
    });
    expect(screen.getByLabelText('mfeflow dev overlay').textContent).toContain(
      'cart · load: timed out after 5000 ms',
    );
  });
});
