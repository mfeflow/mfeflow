# storybook

Storybook 10 on Rsbuild in every remote, and one Storybook in the shell that shows them all. Off by default.

```sh
pnpm mfeflow add storybook
pnpm storybook          # builds each remote's Storybook, then opens the shell's with all of them
pnpm storybook:build    # the same, as static files: apps/shell/storybook-static
```

## Versions

Storybook 10.6.5 with [`storybook-react-rsbuild`](https://github.com/storybook-js/rsbuild) 3.6.1, which accepts
Rsbuild 2 (`@rsbuild/core: ^1.5.0 || ^2.0.0-0`). Both are pinned, and the matrix builds the composed Storybook on every
run, so a break shows up there before it reaches you.

## What you get

| File                                        | What it is for                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/<remote>/.storybook/main.ts`          | The remote's Storybook: stories from `src/**/*.stories.tsx`.                                   |
| `apps/<app>/.storybook/rsbuild.config.ts`   | The Rsbuild config Storybook builds with: React and one copy of `react`. No Module Federation. |
| `apps/<remote>/src/exposed/App.stories.tsx` | A story of the remote's `App`, as the shell would load it.                                     |
| `apps/shell/.storybook/main.ts`             | The composed Storybook. Lists every remote as a ref.                                           |
| `apps/shell/src/pages/Home.stories.tsx`     | A story for the shell's home page (the empty state).                                           |
| `src/components/ui/button.stories.tsx`      | With [`ui-shadcn`](./ui-shadcn): the Button's variants.                                        |

## How the composition works

Each remote builds its own Storybook to `apps/<remote>/storybook-static`, not into `dist`: `rsbuild build` empties `dist`, and
everything in it is what gets deployed. `storybook-static` is in the generated `.gitignore`, `.prettierignore` and oxlint ignores. The shell's `main.ts` reads `mfeflow.json`,
finds the remotes that have one, copies each into its own output under `/<remote>/` (`staticDirs`) and registers it as a
ref (`url: './<remote>'`). The sidebar then shows `shell` and every remote, and a story from a remote renders in that
remote's own iframe, with that remote's dependencies and CSS. Nothing is read from the remote's source by the shell.

Add a remote with `mfeflow add remote orders`: it gets its `.storybook` folder, and the next `pnpm storybook` lists it.
A remote without a built Storybook is skipped instead of breaking the shell's.

## One command at a time

`pnpm storybook` builds the remotes, then runs the shell's Storybook as a dev server, so the shell's stories reload as
you edit them. Remote stories are the built copy: to work on a remote with hot reload, run `pnpm storybook` inside
that remote's folder (Storybook takes the next free port when 6006 is busy), and rebuild when you are done.

## The build is separate from Module Federation

`apps/<app>/rsbuild.config.ts` sets up Module Federation and the app's entry. Stories need neither, so Storybook
reads `.storybook/rsbuild.config.ts` instead. If your stories need an alias, a loader or a PostCSS plugin, add it
there (PostCSS config files such as the one from `tailwind` are picked up as they are).

## Notes

- `esbuild` (a Storybook dependency) is marked `false` in `allowBuilds` in `pnpm-workspace.yaml`: it works without
  its install script, and pnpm 11 and later stop the install to ask otherwise.
- Telemetry and the "what's new" notice are turned off in both `main.ts` files.
- With `theming`, `i18n` or `data-react-query`, a remote's `App` already works without the shell: the story needs no
  decorator. A story that uses `useTheme()` does: wrap it in `ThemeProvider` with a decorator.
