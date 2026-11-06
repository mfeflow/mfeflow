# @mfeflow/theme

Design tokens as CSS variables for micro-frontends. The shell picks the theme once and writes `--mf-<token>` variables, `data-theme` and `color-scheme` on `<html>`; every remote inherits them. The choice is persisted, and `noFlashScript` applies it before first paint.

## Install

```sh
pnpm add @mfeflow/theme @mfeflow/storage
```

`react` (19) is an optional peer dependency, needed only for `@mfeflow/theme/react`.

## Usage

In the shell:

```tsx
import { defineTheme, noFlashScript } from '@mfeflow/theme';
import { ThemeProvider, useTheme } from '@mfeflow/theme/react';

export const themes = [
  defineTheme('light', { 'color-bg': '#ffffff', 'color-fg': '#111111' }),
  defineTheme('dark', { 'color-bg': '#111111', 'color-fg': '#f5f5f5' }, { colorScheme: 'dark' }),
];

// <ThemeProvider themes={themes} defaultTheme="light"> ... </ThemeProvider>
// Put noFlashScript(themes, { defaultTheme: 'light' }) in an inline <script> in the <head>.
```

In a remote, read the tokens:

```css
.card {
  background: var(--mf-color-bg);
}
```

Or in TypeScript, `cssVar('color-bg', '#fff')` returns `var(--mf-color-bg, #fff)`. `useTheme()` returns `{ theme, themes, setTheme }`.

`startingTheme(themes, { defaultTheme })` from `@mfeflow/theme/starting` returns the theme to show before React renders: the stored choice, else the system dark preference, else the default.

## Module Federation sharing

Bucket: **singleton**. This package keeps page-wide state, so the shell and every remote must use one copy. `@mfeflow/rsbuild` and `@mfeflow/vite` share it as a Module Federation singleton by default (the list is in `@mfeflow/bundler-shared`); if you configure sharing by hand, mark it `singleton: true`. A micro-frontend app must also list `@mfeflow/theme` in its own dependencies, even if it imports only a company wrapper such as `@acme/theme`: the presets share the package only when the app can resolve it from its own folder.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
