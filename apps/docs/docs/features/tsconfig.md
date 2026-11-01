---
title: tsconfig - strict TypeScript presets
description: Strict TypeScript 7 presets shared by every app, and a typecheck script that runs per app and across the whole repo.
---

# tsconfig

Every app in a micro-frontend platform should be held to the same TypeScript rules, and changing a rule should be a one-line edit rather than a change in a dozen files. This feature makes every app extend one shared set of presets.

## What you get

Each app gets a small `tsconfig.json` that extends a preset from `@mfeflow/tsconfig`, and a `typecheck` script. The presets turn on the strict checks that catch real bugs, such as unchecked array access and optional properties that are really undefined.

## It is already there

You do not add this one. It is part of every project, so `mfeflow init` applies it and it is not offered as a choice. Features such as [lint-oxlint](/features/lint-oxlint) and [http](/features/http) list it as a requirement.

What it wrote:

- `tsconfig.json` in the shell and in every remote
- `tsconfig.json` at the project root, for scripts and end-to-end tests
- `@mfeflow/tsconfig` and `typescript` 7.0.2 as dev dependencies
- a `typecheck` script in each app, and one at the root

## Use it

An app's file extends the preset and lists what to check.

```json title="apps/cart/tsconfig.json"
{
  "extends": "@mfeflow/tsconfig/react-app.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "rsbuild.config.ts", "env.ts", "vitest.config.ts"]
}
```

The root file uses the Node preset.

```json title="tsconfig.json"
{
  "extends": "@mfeflow/tsconfig/node.json",
  "include": ["*.ts", "scripts", "e2e"]
}
```

Run the checks from the root. Each app runs `tsc --noEmit`, and the root script fans out through Turborepo.

```sh
pnpm typecheck
```

## Configure it

There are no install options. You choose a preset, and you override single compiler options in the app's own file.

| Preset               | Extends | Adds                                                                      |
| -------------------- | ------- | ------------------------------------------------------------------------- |
| `base.json`          | none    | The strict settings below                                                 |
| `react-app.json`     | base    | DOM libs, `jsx: react-jsx`, `noEmit`                                      |
| `react-library.json` | base    | DOM libs, `jsx: react-jsx`, declaration files with `isolatedDeclarations` |
| `node.json`          | base    | Node types, `noEmit`                                                      |

Generated apps use `react-app.json` and the root uses `node.json`. The library preset is there for packages you publish.

## How it works

The base preset targets ES2022 with bundler module resolution, and turns on these checks beyond `strict`:

```json title="@mfeflow/tsconfig/base.json"
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"verbatimModuleSyntax": true,
"isolatedModules": true
```

Rsbuild does the building, so TypeScript only checks, which is why the app presets are `noEmit`. The package needs TypeScript 7 or newer as a peer dependency.

## Gotchas

- `noUncheckedIndexedAccess` makes `items[0]` possibly undefined. Check it, or destructure with a default.
- `exactOptionalPropertyTypes` rejects passing `undefined` to an optional property. Leave the key out instead.
- `verbatimModuleSyntax` requires `import type` for imports that are only types.
- Add a new file or folder to `include` in the app's `tsconfig.json`, or the check will not see it.

## Reference

- [lint-oxlint](/features/lint-oxlint), which reads the same TypeScript setup
- [Project structure](/guide/project-structure)
- [Upgrading](/guide/upgrading)
- [feature.json reference](/reference/feature-json)
