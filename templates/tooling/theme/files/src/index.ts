import { defineTheme, type Theme } from '@mfeflow/theme';
import { darkTokens, lightTokens } from './tokens';

export * from '@mfeflow/theme';
export { darkTokens, lightTokens } from './tokens';

export interface CompanyThemes {
  themes: readonly Theme[];
  defaultTheme: string;
}

/**
 * The company's light and dark themes, built from `src/tokens.ts`, with the default to start from. For the shell:
 * `<ThemeProvider {...createThemes()}>` and `noFlashScript(themes, { defaultTheme })`.
 */
export function createThemes(): CompanyThemes {
  return {
    themes: [
      defineTheme('light', lightTokens),
      defineTheme('dark', darkTokens, { colorScheme: 'dark' }),
    ],
    defaultTheme: 'light',
  };
}
