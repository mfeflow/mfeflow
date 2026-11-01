---
title: lint-oxlint - fast type-aware linting
description: oxlint with type-aware rules and a Prettier setup for the whole repo, so one lint command checks every app the same way.
---

# lint-oxlint

A micro-frontend repo holds many apps written by different people, and a shared lint config is what keeps them consistent. This feature adds oxlint, which is fast enough to run on every save, with rules that use TypeScript's type information to catch async and unsafe-type mistakes.

## What you get

You get one lint config and one Prettier config at the repo root, covering the shell and every remote. Three scripts run them: `lint`, `format` and `format:check`.

## Add it

This is a default feature, so a new project already has it. To add it to a project that skipped it:

```sh
pnpm mfeflow add lint-oxlint
```

What changed, at the project root:

```text
./
├── .oxlintrc.json     # extends the shared oxlint config
├── .prettierrc.json   # the Prettier style
├── .prettierignore    # files Prettier skips
└── package.json       # three new scripts and the dev dependencies
```

The new scripts are `lint`, `format` and `format:check`. These dev dependencies are added:

```text
oxlint
oxlint-tsgolint
prettier
@mfeflow/oxlint-config
```

## Use it

```sh
pnpm lint
pnpm format
```

The lint script runs the command below, so a warning fails the run as an error would.

```sh
oxlint --type-aware --deny-warnings
```

Use `pnpm format:check` in CI and `pnpm format` locally. For a case you cannot fix, disable one rule on one line and say why.

```ts
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the deploy check validated this file against the schema
```

## Configure it

There are no install options. The generated config extends the shared one and only adds ignores.

```json title=".oxlintrc.json"
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": ["./node_modules/@mfeflow/oxlint-config/oxlintrc.json"],
  "ignorePatterns": ["**/dist/**", "**/.turbo/**", "**/storybook-static/**"]
}
```

| What                 | File               | Default                                                                            |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| Rules and plugins    | `.oxlintrc.json`   | The shared config; add your own `rules` to override                                |
| Ignored folders      | `.oxlintrc.json`   | `dist`, `.turbo`, `storybook-static`                                               |
| Prettier style       | `.prettierrc.json` | single quotes, 100 columns, double quotes in YAML                                  |
| Files Prettier skips | `.prettierignore`  | `dist`, `.turbo`, `storybook-static`, `coverage`, `pnpm-lock.yaml`, `CHANGELOG.md` |

## How it works

The shared config turns on three oxlint categories as errors: `correctness`, `suspicious` and `perf`. It also loads the TypeScript, unicorn, oxc, import, node, React and accessibility plugins.

On top of that it sets type-aware rules. Examples are no floating promises, no misused promises, exhaustive `switch` statements and the family of `no-unsafe-*` checks.

React hooks rules are errors, so the rules of hooks and exhaustive dependencies are enforced. The config also bans file extensions on imports, so you write `./client` and not `./client.ts`.

Side-effect imports are an error too. The exceptions are CSS files and two paths:

```text
./env
./src/theme/head-script
```

Type-aware rules run on `oxlint-tsgolint`, which works from your TypeScript setup, so lint and [tsconfig](/features/tsconfig) stay in step.

## Gotchas

- Type-aware rules need a working tsconfig. If lint reports odd type errors, run `pnpm typecheck` first.

- `--deny-warnings` is on, so a new warning from an oxlint upgrade can fail CI until you fix it or turn the rule off.

- Prettier ignores `pnpm-lock.yaml` and `CHANGELOG.md`, so do not format them by hand.

- Files under `scripts/` and `bin/` are allowed to use import extensions, because Node runs them directly.

## Reference

- [tsconfig](/features/tsconfig)
- [git-hooks](/features/git-hooks), which runs the typecheck before a push
- [CI and budgets](/guide/ci-and-budgets)
- [feature.json reference](/reference/feature-json)
