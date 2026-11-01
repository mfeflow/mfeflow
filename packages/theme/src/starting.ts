import { resolveTheme, THEME_STORAGE_KEY, THEME_STORAGE_MFE, type Theme } from '.';

export interface StartingThemeOptions {
  defaultTheme: string;
  /** Use the OS dark-mode preference when no theme is stored. Default true, as for `ThemeProvider`. */
  followSystem?: boolean;
  /** Where the choice is read from. Default `localStorage`. */
  storage?: Pick<Storage, 'getItem'>;
}

function storedName(storage: Pick<Storage, 'getItem'> | undefined): string | undefined {
  try {
    const raw = storage?.getItem(`${THEME_STORAGE_MFE}:${THEME_STORAGE_KEY}`);
    const value: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The theme to show before React renders: the stored choice if it names a theme in the list (a stray value such as
 * "constructor" is not one), else the system dark preference when `followSystem` is on, else the default. The same
 * order `noFlashScript` and `ThemeProvider` use. For the shell's first boot step.
 */
export function startingTheme(themes: readonly Theme[], options: StartingThemeOptions): Theme {
  const storage =
    options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  return resolveTheme(
    themes,
    storedName(storage),
    options.defaultTheme,
    (options.followSystem ?? true) && prefersDark(),
  );
}
