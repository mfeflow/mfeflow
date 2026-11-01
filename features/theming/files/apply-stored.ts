import {
  applyTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  THEME_STORAGE_MFE,
  type Theme,
} from '@mfeflow/theme';
import { defaultTheme, themes } from './themes';

function storedName(): string | undefined {
  try {
    const raw = localStorage.getItem(`${THEME_STORAGE_MFE}:${THEME_STORAGE_KEY}`);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The theme to show before React renders: the stored choice, else the system preference, else the default. */
export function startingTheme(): Theme {
  const stored = storedName();
  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTheme(themes, stored, defaultTheme, stored === undefined && dark);
}

/** Runs first in the shell's boot, so the variables are on <html> before the first render and a reload never shows the wrong theme. */
export function applyStoredTheme(): void {
  applyTheme(startingTheme());
}
