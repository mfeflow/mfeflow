import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createStorage, type MfeStorage } from '@mfeflow/storage';
import { useStoredState } from '@mfeflow/storage/react';
import {
  applyTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  THEME_STORAGE_MFE,
  type Theme,
} from './index.js';

export interface ThemeContextValue {
  theme: Theme;
  themes: readonly string[];
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  themes: readonly Theme[];
  defaultTheme: string;
  /** Use the OS dark-mode preference when nothing is stored. Default true. */
  followSystem?: boolean;
  /** Defaults to the shell's storage. */
  storage?: MfeStorage;
  /** Where CSS variables are written. Defaults to `<html>`. */
  root?: HTMLElement;
  children?: ReactNode;
}

function isThemeName(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** Mount once, in the shell. Remotes call `useTheme()` or just use `cssVar()` tokens. */
export function ThemeProvider({
  themes,
  defaultTheme,
  followSystem = true,
  storage,
  root,
  children,
}: ThemeProviderProps) {
  const store = useMemo(() => storage ?? createStorage(THEME_STORAGE_MFE), [storage]);
  const [stored, setStored] = useStoredState<string | null>(
    store,
    THEME_STORAGE_KEY,
    null,
    isThemeName,
  );
  const theme = resolveTheme(
    themes,
    stored ?? undefined,
    defaultTheme,
    followSystem && stored === null && prefersDark(),
  );

  useLayoutEffect(() => {
    applyTheme(theme, root);
  }, [theme, root]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themes: themes.map((t) => t.name),
      setTheme: (name) => {
        if (!themes.some((t) => t.name === name)) throw new Error(`Unknown theme "${name}"`);
        setStored(name);
      },
    }),
    [theme, themes, setStored],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme and a setter. Works in the shell and in any remote rendered inside it. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value)
    throw new Error('useTheme must be used inside <ThemeProvider> (mounted by the shell)');
  return value;
}
