import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, resetI18nForTests, type NamespaceLoader } from './index.js';
import { useLanguage, useMfeTranslation } from './react.js';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
];

const messages: Record<string, Record<string, string>> = {
  en: { title: 'Cart' },
  hi: { title: 'कार्ट' },
};

const cartLoader = vi.fn<NamespaceLoader>((lng) => Promise.resolve(messages[lng] ?? {}));

function CartTitle() {
  const { t, ready } = useMfeTranslation('cart', cartLoader);
  return <h1 data-testid="title">{ready ? t('title') : '…'}</h1>;
}

function Broken() {
  const { ready } = useMfeTranslation('broken', () => Promise.reject(new Error('down')));
  return <span data-testid="ready">{String(ready)}</span>;
}

beforeEach(async () => {
  cartLoader.mockClear();
  await initI18n({ languages, defaultLanguage: 'en', detect: false });
});

afterEach(() => {
  cleanup();
  resetI18nForTests();
  localStorage.clear();
});

describe('useMfeTranslation', () => {
  it('loads the namespace on mount and re-renders when the language changes', async () => {
    render(<CartTitle />);
    await waitFor(() => {
      expect(screen.getByTestId('title').textContent).toBe('Cart');
    });
    const { result } = renderHook(() => useLanguage());
    await act(() => result.current.setLanguage('hi'));
    await waitFor(() => {
      expect(screen.getByTestId('title').textContent).toBe('कार्ट');
    });
    expect(cartLoader.mock.calls.map(([lng]) => lng)).toEqual(['en', 'hi']);
  });

  it('logs and still renders when a namespace cannot load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Broken />);
    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('useLanguage', () => {
  it('lists languages and rejects unknown ones', async () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current.language).toBe('en');
    expect(result.current.languages.map((l) => l.code)).toEqual(['en', 'hi']);
    await expect(result.current.setLanguage('fr')).rejects.toThrow(/Unknown language "fr"/);
  });
});
