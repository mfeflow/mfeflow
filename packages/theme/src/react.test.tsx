import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { defineTheme } from './index.js';
import { ThemeProvider, useTheme } from './react.js';

const light = defineTheme('light', { 'color-bg': '#fff' });
const dark = defineTheme('dark', { 'color-bg': '#000' }, { colorScheme: 'dark' });

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

function Picker() {
  const { theme, themes, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current">{theme.name}</span>
      {themes.map((name) => (
        <button key={name} type="button" onClick={() => setTheme(name)}>
          {name}
        </button>
      ))}
    </div>
  );
}

// Stands in for a remote rendered inside the shell's tree.
function Remote() {
  return <span data-testid="remote">{useTheme().theme.name}</span>;
}

function App() {
  return (
    <ThemeProvider themes={[light, dark]} defaultTheme="light" followSystem={false}>
      <Picker />
      <Remote />
    </ThemeProvider>
  );
}

describe('ThemeProvider', () => {
  it('applies the default theme to <html>', () => {
    render(<App />);
    expect(screen.getByTestId('current').textContent).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--mf-color-bg')).toBe('#fff');
  });

  it('switches theme for every consumer and persists the choice', () => {
    render(<App />);
    act(() => screen.getByText('dark').click());
    expect(screen.getByTestId('current').textContent).toBe('dark');
    expect(screen.getByTestId('remote').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('shell:theme')).toBe('"dark"');
  });

  it('restores the stored theme', () => {
    localStorage.setItem('shell:theme', '"dark"');
    render(<App />);
    expect(screen.getByTestId('current').textContent).toBe('dark');
  });

  it('rejects unknown themes', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider themes={[light]} defaultTheme="light">
          {children}
        </ThemeProvider>
      ),
    });
    expect(() => {
      result.current.setTheme('neon');
    }).toThrow(/Unknown theme "neon"/);
  });

  it('throws outside the provider', () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Remote />)).toThrow(/inside <ThemeProvider>/);
    } finally {
      console.error = original;
    }
  });
});
