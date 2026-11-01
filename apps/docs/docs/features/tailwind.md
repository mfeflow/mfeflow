# tailwind

Tailwind CSS 4 with one reset and one class prefix per app. Off by default.

```sh
pnpm mfeflow add tailwind
```

## The problem it solves

Two remotes are built and deployed on their own, then loaded into the same page. If both use Tailwind the usual way,
both ship the reset and both define `.flex`, `.p-4` and `--color-primary`. Whichever stylesheet loads last wins, so a
change to one remote's tokens changes the other remote.

## What you get

| File                                   | What it is for                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/<app>/postcss.config.mjs`        | Tailwind's PostCSS plugin. Rsbuild picks the file up on its own.                                                                    |
| `apps/shell/src/styles.css`            | Theme, **reset (preflight)** and utilities. The only app with the reset.                                                            |
| `apps/<remote>/src/styles.css`         | Theme and utilities only, with the remote's prefix.                                                                                 |
| `apps/<remote>/src/tailwind/Scope.tsx` | Wraps the remote's `App` and loads its stylesheet. The outline is a sample of the `primary` token; replace it with your own markup. |

## The prefix

Every app has a prefix made of its name's letters: `cart` writes `cart:flex cart:p-4 cart:bg-primary`; `cart2` becomes
`cartc` (Tailwind accepts lowercase letters only, so a digit becomes the letter at that position in the alphabet and
other characters are dropped). The theme variables are prefixed as well (`--cart-spacing`), so two remotes cannot write
to the same variable. Pick the prefix yourself by editing the `prefix(...)` in `styles.css` and in the classes.

Two remotes can then define the same token differently:

```css
/* apps/cart/src/styles.css */
@theme inline {
  --color-primary: #0f766e;
}
/* apps/catalog/src/styles.css */
@theme inline {
  --color-primary: #b91c1c;
}
```

`cart:bg-primary` is teal and `catalog:bg-primary` is red, on the same page. The matrix runs exactly this in a browser
and compares the computed colours.

## Tokens and the theme

The generated tokens use shadcn's names (`background`, `foreground`, `surface`, `primary`, `primary-foreground`, `secondary`, `accent`, `destructive`, `border`, `ring`) and read the `--mf-*` variables from [`theming`](./theming), each with a
fallback, so they follow the active theme when `theming` is installed (before or after), and keep working without it.

## Reset in the shell only

Preflight is `@layer base`. The shell loads it once for the page, so remotes do not repeat it and do not fight over it.
The consequence: a remote opened on its own (`pnpm dev` in its folder) has no reset. Add
`@import 'tailwindcss/preflight.css' layer(base);` to that remote's `styles.css` while you work on it, and remove it
before you deploy.

## Layers

Everything Tailwind emits is in a cascade layer (`theme`, `base`, `components`, `utilities`). CSS that is not in a
layer beats all of it, so plain CSS from a remote or a library is never overridden by a utility by accident.

## Versions

`tailwindcss` and `@tailwindcss/postcss` are pinned to 4.3.3 and installed as dev dependencies of each app. The
integration is the PostCSS plugin, which works with Rsbuild 2 (the build is checked on every matrix run).
