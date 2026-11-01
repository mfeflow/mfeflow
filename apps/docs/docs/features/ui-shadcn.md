# ui-shadcn

shadcn/ui in every remote, on top of [`tailwind`](./tailwind). Needs `tailwind` first; off by default.

```sh
pnpm mfeflow add tailwind ui-shadcn
```

## What you get

Per remote:

| File                           | What it is for                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `components.json`              | shadcn's config, with `"css": "src/styles.css"` and this remote's `"prefix"`.                                          |
| `src/lib/utils.ts`             | `cn()`: `clsx` plus `tailwind-merge` that knows the remote's prefix, so `cart:p-2` and `cart:p-4` merge to `cart:p-4`. |
| `src/components/ui/button.tsx` | A `Button` with five variants and three sizes, written the way shadcn writes it, with prefixed classes.                |

The components are copied into the remote and are yours: change them, delete them, add more. They are not a package,
and nothing is shared between remotes. A button in `cart` and a button in `catalog` are two files that look the same
because they read the same theme tokens.

## Colours

The classes use the tokens `tailwind` defines (`primary`, `primary-foreground`, `secondary`, `accent`, `border`,
`background`, `ring`, ...). They read `--mf-*` variables, so with [`theming`](./theming) a theme switch recolours every
remote's buttons together.

## Adding more components

`components.json` is written for the shadcn CLI. The CLI resolves `@/...` imports, so give the remote that alias first
(three lines, once):

```json
// apps/<remote>/tsconfig.json, under compilerOptions
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

Rsbuild reads `paths` from the tsconfig. Then:

```sh
cd apps/cart
pnpm dlx shadcn@latest add dialog
```

The CLI adds the remote's prefix to the class names it writes (that is what `"prefix"` in `components.json` is for).
Check one component after adding it. shadcn's Button uses `asChild` with Radix `Slot`; this one leaves it out, so
the remote has no Radix dependency until you want one.

## Cost

`class-variance-authority`, `clsx` and `tailwind-merge` only land in the remote's bundle when something imports them. The Button is not used by anything yet, so a remote that does not use it pays
nothing. Mind the 10 KB budget when you do.
