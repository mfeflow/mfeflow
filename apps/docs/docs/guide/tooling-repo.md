---
title: A repo for shared tooling
description: Make a repo with no apps that holds shared config, git hooks, release and thin wrapper packages in your own scope, and use it from the app repos. Covers the one extra dependency a wrapper needs in a micro-frontend.
---

# A repo for shared tooling

A tooling repo has no shell and no remotes. It holds what several app repos have in common: a TypeScript config, lint rules, git hooks, the release setup, and small packages in your own scope (`@acme/analytics`, `@acme/theme` and so on) that each wrap one of ours and carry your defaults. App repos depend on `@acme/...`.

## When to use it

Use it when more than one repo needs the same settings and you would rather change them in one place. Two examples: every repo should extend the same `tsconfig` and oxlint rules, or every app should start analytics with the same consent defaults and container ids.

Skip it if you have one repo. A normal project already has the platform packages `contracts` and `tokens` inside it, and the lint and hook features can be added there with `mfeflow add`.

## Create it

```bash
mfeflow init acme-tooling --kind tooling --scope @acme \
  --packages tsconfig,oxlint-config,analytics,http \
  --features lint-oxlint,git-hooks
```

The last lines of the output:

```text
Warning: packages: also made url-factory, which http needs

Created /work/acme-tooling, a repo for shared tooling with no apps.
Next:
  cd acme-tooling
  pnpm install
  pnpm build
```

Without `--packages` you get `tsconfig` and `oxlint-config`. Without `--features` you get `lint-oxlint` and `git-hooks`. The repo is its own git repository from the start, so the hooks are installed into it and not into a folder above it.

## What you get

```text
packages/contracts     @acme/contracts: event names and types every repo agrees on
packages/tokens        @acme/tokens: colors and spacing
packages/tsconfig      @acme/tsconfig
packages/oxlint-config @acme/oxlint-config
packages/analytics     @acme/analytics
packages/http          @acme/http
packages/url-factory   @acme/url-factory, added because http needs it
default.json           a Renovate preset other repos can extend
.changeset             how a change gets a version
.github/workflows      reusable CI, CI and release
```

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all run, and `mfeflow validate` says the repo has no apps:

```text
This project has no apps, so the checks about apps have nothing to look at.
```

CI generates a repo like this one on every change and runs the same commands on it ([the script](https://github.com/mfeflow/mfeflow/blob/main/scripts/smoke-tooling.mjs)).

## The packages

Each wrapper depends on our package of the same name, re-exports all of it, and adds your defaults in a file you edit, usually `src/defaults.ts`. The names you can pick are `tsconfig`, `oxlint-config`, `analytics`, `telemetry`, `http`, `theme`, `i18n`, `event-bus`, `route-factory`, `url-factory`, `storage`, `runtime` and `testing`. A package that needs another adds it and the command says so. The [CLI reference](/reference/cli) has the rules.

`@acme/oxlint-config` has a build step. oxlint reads `extends` as a file path and does not look a package name up, so the package writes `dist/oxlintrc.json` from our rules and your `overrides.json` when you run `pnpm build`. The file is not committed. An app repo points at it by path:

```json
{ "extends": ["./node_modules/@acme/oxlint-config/dist/oxlintrc.json"] }
```

`@acme/tsconfig` needs no build. In an app repo:

```json
{ "extends": "@acme/tsconfig/react-app.json", "include": ["src"] }
```

### For micro-frontends

`runtime` and `testing` only make sense for teams that run a shell: `runtime` loads remotes from a registry, and `testing` wraps components in the shell's providers. The command prints a note when you pick them. `analytics`, `telemetry`, `theme`, `i18n` and `event-bus` are shared between a shell and its remotes, so they are the ones affected by the next two sections.

## Use a wrapper from an app repo

While you try it out, link the package by path. Later, publish the packages and use a version range.

```json
{
  "dependencies": {
    "@acme/theme": "link:../acme-tooling/packages/theme"
  }
}
```

Build the tooling repo first; a linked package is read from its `dist`.

### Micro-frontends need one more line

If the app is a shell or a remote built with mfeflow, and it uses `@acme/theme`, `@acme/i18n`, `@acme/runtime`, `@acme/analytics`, `@acme/telemetry` or `@acme/event-bus`, it also lists our package of the same name in its own `package.json`:

```bash
pnpm add @mfeflow/theme
```

Use the range the wrapper uses; it is in the wrapper's `package.json`. Do this in the shell and in every remote that imports the wrapper.

The reason is how the presets pick what to share. They share `@mfeflow/theme`, `@mfeflow/i18n`, `@mfeflow/runtime`, `@mfeflow/analytics`, `@mfeflow/telemetry` and `@mfeflow/event-bus` as singletons by name, but only when the app can resolve that name from its own folder. pnpm does not make a dependency of a dependency visible there. An app that lists only `@acme/theme` therefore has no `@mfeflow/theme` to share, and the preset leaves it out without a message.

This was tried on a shell and two remotes that import only the wrappers `@acme/theme` and `@acme/event-bus`. The shared packages the preset returned for a remote:

```text
without @mfeflow/theme in the app:
  react react/jsx-runtime react/jsx-dev-runtime react-dom react-dom/client

with @mfeflow/theme in the app:
  react react/jsx-runtime react/jsx-dev-runtime react-dom react-dom/client @mfeflow/theme @mfeflow/theme/react
```

In the browser (headless Chromium, `mfeflow dev`), the shell has the theme provider and each remote shows the name of the theme it reads:

- Without the line, both remotes fail with `useTheme must be used inside <ThemeProvider> (mounted by the shell)`. Each remote had its own copy of the theme package, and the provider is in the shell's copy.
- With the line, both remotes show `light`.

The event bus did not need the line in that run: the remotes saw an event the shell published even without it. The event bus, analytics and telemetry keep their state on `globalThis` (read in their source), so a second copy of the package still reaches the same subscribers. The theme package keeps its state in a React context, and `i18n` is built on contexts too (read, not run), so those two are the ones that break. Add the line for all of them anyway; it costs nothing and does not depend on how a package stores its state.

Two other ways were tried and do not replace the line. A peer dependency on `@mfeflow/theme` in the wrapper does not help with pnpm: it installs the peer next to the wrapper and leaves the app's own folder without it (tried with a small test package). Putting the wrapper's name in the preset's `shared` option works, but it has to be repeated for every subpath and in the shell and every remote, and the shell must depend on the wrapper too. Telling the preset to look through the wrappers for our packages would remove the extra line; that change is not made yet.

## Wrappers hold settings and no state

A wrapper is not in the list of shared singletons, so every remote gets its own copy of it. That is harmless while the wrapper holds settings and functions that build things. It is wrong as soon as the wrapper keeps state at module level, because each remote then has its own state.

A throwaway wrapper with a counter at module level, imported by two remotes, shows it. Each remote read the counter once when it loaded:

```text
not shared:                          catalog: 1   cart: 1
shared in the shell and both remotes: catalog: 1   cart: 2
```

With the package in the `shared` option of the shell and both remotes, the second remote sees the first one's count. Without it, the two remotes count separately. So keep state in `@mfeflow/*` or in the shell, and keep the wrapper to settings. Each wrapper's README says this too, and a test in this repo checks that no wrapper's source has module-level state.

## What is not supported yet

- `mfeflow upgrade` does nothing in a tooling repo. It prints `This project has no apps, so there is nothing to upgrade. Update the mfeflow packages in package.json by hand.`
- `ci-github` is refused (E107). The repo already has a `ci.yml` that builds and validates, and the other steps of that feature are about apps.
- Features that need an app are refused with [E216](/errors/E216). That includes `env-t3` and `analytics-gtm`, which write into a shell. A tooling repo takes `lint-oxlint`, `git-hooks`, `commit-prompt` and `release`.
- `release` is accepted but adds nothing, because the repo already versions and publishes with Changesets.
- Analytics goes as far as the `analytics` wrapper: consent defaults, a container id per environment and `createAnalytics(env)`. A shared tracking plan or event list is not made for you. Put it in `packages/contracts`.
- There is no `--kind remote` yet; it answers that it is not available in this release.

## Related

- [Can I have a repo with no apps?](/guide/faq#can-i-have-a-repo-with-no-apps)
- [E216](/errors/E216): what the error says when a feature needs an app.
- [One repo per team](/guide/polyrepo): the platform repo of a polyrepo is the same kind of repo, made inside a bigger `init`.
