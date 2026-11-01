---
title: storybook - every remote's stories in one place
description: Give each remote its own Storybook and browse them all from the shell, with new remotes appearing in the sidebar without any config edit.
---

# storybook

This page explains how to develop and review components in isolation, one Storybook per remote, and how to see all of them together. The shell's Storybook lists every remote, so reviewers open one URL.

## What you get

Each remote gets a Storybook on Rsbuild and a starter story for its `App`. The shell gets a Storybook that embeds every remote's built Storybook as a reference. This feature is off by default.

## Add it

```sh
pnpm mfeflow add storybook
```

What changed:

- `.storybook/main.ts` and `.storybook/rsbuild.config.ts` in the shell and every remote
- `src/exposed/App.stories.tsx` in each remote and `src/pages/Home.stories.tsx` in the shell
- `src/components/ui/button.stories.tsx` in each remote, only when `ui-shadcn` is installed
- `storybook` and `storybook:build` scripts in every app and at the project root
- Storybook 10.6.5 with `storybook-react-rsbuild` 3.6.1, both pinned, as dev dependencies

## Use it

From the project root:

```sh
pnpm storybook         # builds each remote's Storybook, then runs the shell's with all of them
pnpm storybook:build   # the same as static files in apps/shell/storybook-static
```

A story for a remote component is a normal Storybook story:

```tsx title="apps/cart/src/exposed/App.stories.tsx"
import type { Meta, StoryObj } from 'storybook-react-rsbuild';
import App from './App';

const meta = { title: 'cart/App', component: App } satisfies Meta<typeof App>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
```

Remotes show up in the shell's sidebar as soon as they have a built Storybook. Add a remote with `pnpm mfeflow add remote orders` and the next `pnpm storybook` lists it.

To work on one remote with hot reload, run `pnpm storybook` inside that remote's folder. Storybook takes the next free port if 6006 is busy.

## Configure it

There are no install options. These are the files you edit:

| File                            | Change it to                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `.storybook/main.ts`            | Add addons or change where stories are found (`src/**/*.stories.*`) |
| `.storybook/rsbuild.config.ts`  | Add an alias, a loader or a PostCSS plugin your stories need        |
| `apps/shell/.storybook/main.ts` | Rarely; it builds the remote list from `mfeflow.json`               |

## How it works

Each remote builds its Storybook to `apps/<remote>/storybook-static`, not into `dist`, because the build empties `dist` and everything in it gets deployed. The shell's `main.ts` reads `mfeflow.json`, copies each built remote under `/<remote>/` and registers it as a reference. A story from a remote renders in that remote's own frame, with its own dependencies and CSS.

Storybook builds with `.storybook/rsbuild.config.ts`, which has React and nothing else. The app's own `rsbuild.config.ts` sets up Module Federation, which stories do not need. PostCSS config files, such as the one from `tailwind`, are picked up as they are.

## Gotchas

- Remote stories in the shell's Storybook are the built copy, so rebuild with `pnpm storybook` after changing a remote. A remote without a built Storybook is skipped instead of breaking the shell's.
- With `theming`, `i18n` or `data-react-query`, a remote's `App` works without the shell, so its story needs no decorator. A story that calls `useTheme()` does need one that wraps it in `ThemeProvider`.
- `esbuild` is set to `false` in `allowBuilds` in `pnpm-workspace.yaml`. It works without its install script, and without that entry pnpm 11 stops the install to ask.

## Reference

- [ui-shadcn](/features/ui-shadcn)
- [theming](/features/theming)
- [Project structure](/guide/project-structure)
- [storybook-react-rsbuild](https://github.com/storybook-js/rsbuild)
