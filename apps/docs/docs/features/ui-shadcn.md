---
title: ui-shadcn - shadcn/ui components you own
description: A cn helper, a Button and a shadcn config copied into every remote, with the remote's Tailwind prefix and your theme colours built in.
---

# ui-shadcn

shadcn/ui gives you components as source files rather than a package. This feature sets that up in each remote on top of the Tailwind prefix, so the components carry the right class names and read the same theme as the rest of the page.

## What you get

Every remote gets its own copy of a `Button`, a `cn` class helper and a shadcn config. Nothing is shared between remotes: a button in `cart` and a button in `catalog` are two files that look the same because they read the same theme tokens.

## Add it

`ui-shadcn` needs [tailwind](/features/tailwind). Add both in one command, or add `tailwind` first. Without it, `add` stops with [E206](/errors/E206).

```sh
pnpm mfeflow add tailwind ui-shadcn
```

What changed, in every remote:

- `components.json`, shadcn's config, with the remote's `css` path and prefix
- `src/lib/utils.ts`, the `cn` helper, and its test if you use [testing](/features/testing)
- `src/components/ui/button.tsx`, and its test
- `class-variance-authority`, `clsx` and `tailwind-merge` as dependencies

## Use it

Import the button from the remote's own folder and use it like any component.

```tsx
import { Button } from './components/ui/button';

<Button variant="outline" size="sm" onClick={save}>
  Save
</Button>;
```

The files are yours to change or delete. This is the start of the generated button, where every class carries the remote's prefix (`cart` here).

```tsx title="apps/cart/src/components/ui/button.tsx"
variant: {
  default: 'cart:bg-primary cart:text-primary-foreground cart:hover:opacity-90',
  secondary: 'cart:bg-secondary cart:text-secondary-foreground cart:hover:opacity-80',
  outline: 'cart:border cart:border-border cart:bg-background cart:hover:bg-accent cart:hover:text-accent-foreground',
  destructive: 'cart:bg-destructive cart:text-white cart:hover:opacity-90',
  ghost: 'cart:hover:bg-accent cart:hover:text-accent-foreground',
},
```

## Configure it

There are no install options. These are the knobs you will actually reach for.

| Setting       | Where             | Values                                                                    |
| ------------- | ----------------- | ------------------------------------------------------------------------- |
| `variant`     | `Button` prop     | `default`, `secondary`, `outline`, `destructive`, `ghost`                 |
| `size`        | `Button` prop     | `default`, `sm`, `lg`                                                     |
| `type`        | `Button` prop     | `button` unless you pass `submit`, so it never submits a form by accident |
| `style`       | `components.json` | `new-york`                                                                |
| `baseColor`   | `components.json` | `neutral`                                                                 |
| `prefix`      | `components.json` | this remote's Tailwind prefix                                             |
| `iconLibrary` | `components.json` | `lucide`                                                                  |

## How it works

`cn` joins class names with `clsx` and then merges them with `tailwind-merge`, told about the remote's prefix. That is why `cn('cart:p-2', 'cart:p-4')` keeps only `cart:p-4`. The colours come from the tokens the [tailwind](/features/tailwind) feature defines, which read `--mf-*` variables, so with [theming](/features/theming) a theme switch recolours every remote's buttons together.

The three helper libraries only reach a remote's bundle when something imports them. Nothing uses the `Button` yet, so a remote that does not use it pays nothing. Watch the default 10 KB remote budget when you start using it.

## Gotchas

- To add more components with the shadcn CLI, first give the remote the `@/` alias it expects. Add this under `compilerOptions` in the remote's `tsconfig.json`; Rsbuild reads `paths` from it.

  ```json
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
  ```

- Then run the CLI from the remote's folder. It adds the prefix to the classes it writes, because of `"prefix"` in `components.json`.

  ```sh
  cd apps/cart
  pnpm dlx shadcn@latest add dialog
  ```

- Check one new component after adding it. This `Button` leaves out shadcn's `asChild` and Radix `Slot`, so the remote has no Radix dependency until you add a component that needs one.

## Reference

- [tailwind](/features/tailwind), which defines the prefix and tokens
- [theming](/features/theming)
- [Cost model](/concepts/cost-model), where the remote budget comes from
- [feature.json reference](/reference/feature-json)
