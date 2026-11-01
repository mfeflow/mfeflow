---
title: tailwind - Tailwind 4 without style collisions
description: Tailwind CSS 4 with one reset in the shell and a class prefix per app, so two remotes can use the same utility with different tokens.
---

# tailwind

Two remotes that are built and deployed separately end up on the same page. If both use Tailwind the usual way, both define `.flex` and `--color-primary`, the last stylesheet to load wins, and a token change in one remote quietly restyles the other. This feature gives every app its own class prefix and loads the reset only once.

## What you get

Each app gets Tailwind 4 through PostCSS, a stylesheet with colour tokens that follow your theme, and utilities written with the app's prefix, such as `cart:flex`. The shell owns the reset, and remotes bring only their theme and utilities.

## Add it

```sh
pnpm mfeflow add tailwind
```

If two apps would end up with the same prefix, `add` stops and names both ([E208](/errors/E208)).

What changed in each app:

```text
postcss.config.mjs      # shell and every remote
src/
├── styles.css          # shell: theme, reset, utilities. Remote: theme, utilities
├── bootstrap.tsx       # shell only, imports styles.css
└── tailwind/
    └── Scope.tsx       # remote only, wraps App and loads its stylesheet
```

Every remote also gets a Scope test if you use [testing](/features/testing). Both Tailwind packages are added at 4.3.3 as dev dependencies of every app:

```text
tailwindcss
@tailwindcss/postcss
```

## Use it

Write classes with your app's prefix. This is what the generated `Scope` does in a remote called `cart`.

```tsx title="apps/cart/src/tailwind/Scope.tsx"
const classes = 'cart:p-2 cart:outline-2 cart:outline-primary';

export function Scope({ children }: { children: ReactNode }) {
  return (
    <div data-tailwind="cart" className={classes}>
      {children}
    </div>
  );
}
```

The outline is a sample of the `primary` token. Delete it when you have your own markup.

Because the prefix scopes the tokens too, two remotes can define the same name differently and both stay correct on one page.

```css title="apps/cart/src/styles.css"
@theme inline {
  --color-primary: #0f766e;
}
```

```css title="apps/catalog/src/styles.css"
@theme inline {
  --color-primary: #b91c1c;
}
```

Here `cart:bg-primary` is teal and `catalog:bg-primary` is red.

## Configure it

The feature has no install options. The prefix and the tokens live in `src/styles.css`.

| Setting           | Where                                              | Default                                                                                                                        |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Class prefix      | `prefix(...)` in `styles.css`, and in your classes | the app name; see below for names with other characters                                                                        |
| Colour tokens     | `@theme inline` in `styles.css`                    | `background`, `foreground`, `surface`, `primary`, `primary-foreground`, `secondary`, `accent`, `destructive`, `border`, `ring` |
| Reset (preflight) | the shell's `styles.css` only                      | on in the shell, absent from remotes                                                                                           |
| Layers            | `@layer theme, base, components, utilities`        | all Tailwind output is layered                                                                                                 |

A name made only of lowercase letters is its own prefix. Tailwind accepts nothing else, so other names get four extra letters from a hash of the whole name.

| App name | Prefix                    |
| -------- | ------------------------- |
| `cart`   | `cart`                    |
| `cart_b` | something like `cartqzvk` |
| `cart1`  | another hashed prefix     |

That keeps all three apart. You can pick a prefix yourself by editing it in `styles.css` and in the classes.

## How it works

The generated tokens use shadcn's names and read the `--mf-*` variables from [theming](/features/theming), each with a fallback. They follow the active theme when `theming` is installed, whether you add it before or after, and keep working without it. The theme variables are prefixed as well, as in `--cart-spacing`, so two remotes cannot write to the same one.

Preflight is the only part that cannot be scoped, so the shell loads it once and remotes leave it out. Everything Tailwind emits sits in a cascade layer. CSS outside any layer beats all of it, so plain CSS from a remote or a library is never overridden by a utility by accident.

## Gotchas

- A remote opened on its own with `pnpm dev` has no reset. While you work, add this line to that remote's styles, and take it out before you deploy:

```css
@import 'tailwindcss/preflight.css' layer(base);
```

- Every utility needs the prefix. An unprefixed `flex` in a remote does nothing.
- The integration is the PostCSS plugin, which Rsbuild picks up from `postcss.config.mjs` without extra setup.

## Reference

- [ui-shadcn](/features/ui-shadcn), components built on these tokens
- [theming](/features/theming)
- [Project structure](/guide/project-structure)
- [feature.json reference](/reference/feature-json)
