/** Token name → CSS value, e.g. `{ 'color-primary': '#2563eb', 'radius-md': '8px' }`. */
export type ThemeTokens = Readonly<Record<string, string>>;

export interface Theme {
  readonly name: string;
  readonly colorScheme: 'light' | 'dark';
  readonly tokens: ThemeTokens;
}

/** Every token becomes `--mf-<token>` on `:root`. */
export const CSS_VAR_PREFIX = '--mf-';
/** Storage key (under the `shell` micro-frontend) for the chosen theme. */
export const THEME_STORAGE_KEY = 'theme';
export const THEME_STORAGE_MFE = 'shell';

const TOKEN = /^[a-z][a-z0-9-]*$/;
const THEME_NAME = /^[a-z][a-z0-9-]*$/;

export function cssVarName(token: string): string {
  if (!TOKEN.test(token)) {
    throw new Error(`Invalid token name "${token}": use lowercase letters, digits and dashes`);
  }
  return CSS_VAR_PREFIX + token;
}

/** `var(--mf-<token>)`, for remotes that style with tokens. */
export function cssVar(token: string, fallback?: string): string {
  return fallback === undefined
    ? `var(${cssVarName(token)})`
    : `var(${cssVarName(token)}, ${fallback})`;
}

export function defineTheme(
  name: string,
  tokens: ThemeTokens,
  options: { colorScheme?: 'light' | 'dark' } = {},
): Theme {
  if (!THEME_NAME.test(name)) throw new Error(`Invalid theme name "${name}"`);
  for (const token of Object.keys(tokens)) cssVarName(token);
  return Object.freeze({
    name,
    colorScheme: options.colorScheme ?? 'light',
    tokens: Object.freeze({ ...tokens }),
  });
}

/** CSS custom properties for a theme, keyed by variable name. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [token, value] of Object.entries(theme.tokens)) out[cssVarName(token)] = value;
  return out;
}

const applied = new WeakMap<HTMLElement, Set<string>>();

/**
 * Writes a theme onto `root` (default `<html>`): CSS variables, `data-theme`
 * and `color-scheme`. Variables from the previous theme that the new one does
 * not define are removed. Only the shell calls this; remotes just read tokens.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const vars = themeToCssVars(theme);
  const previous = applied.get(root) ?? new Set<string>();
  for (const name of previous) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied.set(root, new Set(Object.keys(vars)));
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.colorScheme;
}

/** Picks the theme to show: stored choice, then the system dark preference, then the default. */
export function resolveTheme(
  themes: readonly Theme[],
  stored: string | undefined,
  defaultTheme: string,
  prefersDark = false,
): Theme {
  const byName = new Map(themes.map((t) => [t.name, t]));
  const fallback = byName.get(defaultTheme);
  if (!fallback) throw new Error(`Default theme "${defaultTheme}" is not in the theme list`);
  if (stored !== undefined) {
    const hit = byName.get(stored);
    if (hit) return hit;
  }
  if (prefersDark) {
    const dark = themes.find((t) => t.colorScheme === 'dark');
    if (dark) return dark;
  }
  return fallback;
}

export interface NoFlashOptions {
  defaultTheme: string;
  /** Use the OS dark-mode preference when nothing is stored. Default true. */
  followSystem?: boolean;
}

/**
 * Source for an inline `<script>` in the shell's `<head>`. It applies the
 * stored (or system) theme before first paint, so reloads never flash the
 * default theme. It never throws.
 */
export function noFlashScript(themes: readonly Theme[], options: NoFlashOptions): string {
  resolveTheme(themes, undefined, options.defaultTheme);
  const data = JSON.stringify({
    k: `${THEME_STORAGE_MFE}:${THEME_STORAGE_KEY}`,
    d: options.defaultTheme,
    s: options.followSystem ?? true,
    t: Object.fromEntries(themes.map((t) => [t.name, { c: t.colorScheme, v: themeToCssVars(t) }])),
  }).replace(/</g, '\\u003c');
  return `(function(){try{var o=${data};var n;try{n=JSON.parse(localStorage.getItem(o.k)||'null')}catch(e){}if(!o.t[n]){n=o.d;if(o.s&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){for(var x in o.t){if(o.t[x].c==='dark'){n=x;break}}}}var t=o.t[n],r=document.documentElement;for(var v in t.v){r.style.setProperty(v,t.v[v])}r.setAttribute('data-theme',n);r.style.colorScheme=t.c}catch(e){}})();`;
}
