import { applyTheme, type Theme } from '@mfeflow/theme';
import { startingTheme } from '@mfeflow/theme/starting';
import { defaultTheme, followSystem, themes } from './themes';

/** The theme to show before React renders: the stored choice, else the system preference (if followSystem), else the default. */
export function currentStartingTheme(): Theme {
  return startingTheme(themes, { defaultTheme, followSystem });
}

/** The first boot step: the variables are on <html> before the first render, also when the head script was blocked. */
export function applyStoredTheme(): void {
  applyTheme(currentStartingTheme());
}
