# theming

Light and dark themes as CSS variables, with the shell in charge and every remote reading the same tokens. Off by
default.

```sh
pnpm mfeflow add theming
```

## What you get

| File                                   | What it is for                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/shell/src/theme/themes.ts`       | The themes. Each token becomes `--mf-<token>` on `<html>`. Yours to edit: add tokens, add a theme.                          |
| `apps/shell/src/theme/Theme.tsx`       | Wraps the shell in `ThemeProvider` and renders the toggle.                                                                  |
| `apps/shell/src/theme/ThemeToggle.tsx` | A theme picker. Yours: move it into the header, restyle it, swap it for a menu.                                             |
| `apps/shell/src/theme/apply-stored.ts` | The first boot step: puts the stored theme on `<html>` before anything renders.                                             |
| `apps/shell/src/theme/theme.css`       | `html` background and text colour from the tokens, and the toggle's position.                                               |
| `apps/<remote>/src/theme/tokens.ts`    | `tokens.primary` is `var(--mf-color-primary, #2563eb)`: the shell's value, or the fallback when the remote runs on its own. |

With `testing`, the shell gets a test for the stored theme and one for the toggle, and each remote one for its tokens.

## How a remote uses the theme

A remote ships no theme code. It reads variables:

```css
.card {
  background: var(--mf-color-surface);
  color: var(--mf-color-fg);
}
```

or, in TypeScript, `import { tokens } from './theme/tokens'`. Switching the theme changes the variables on `<html>`,
so every remote follows at once, with no re-render and no event between them.

## No flash on reload

The choice is saved under the shell's storage (`shell:theme`). `apply-stored.ts` reads it and sets the variables
before the shell renders its first component, so a reload never paints the default theme first. With no stored
choice, the system dark-mode setting decides.

The one thing it cannot cover is the blank page before any JavaScript has run. If that matters (a dark theme on a slow
connection), add the inline script `@mfeflow/theme` generates to the shell's `<head>`, as the storefront example does:

```ts
// apps/shell/rsbuild.config.ts
import { noFlashScript } from '@mfeflow/theme';
import { defaultTheme, themes } from './src/theme/themes';

// in the html config
tags: [
  { tag: 'script', children: noFlashScript(themes, { defaultTheme }), head: true, append: false },
],
```

An inline script needs `script-src 'unsafe-inline'` or a nonce, which is why it is not on by default.

## With other features

- `tailwind` maps its colour tokens to `--mf-color-*`, so `bg-surface` follows the theme.
- `ui-shadcn` components use those tokens.
