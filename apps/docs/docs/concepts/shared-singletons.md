---
title: Shared singletons
description: Why React and some packages must exist exactly once on a micro-frontend page, which packages mfeflow shares by default, and how version drift and duplicates are detected.
---

# Shared singletons

This page explains why some packages must be loaded once per page, and how mfeflow keeps it that way. It is the most common source of micro-frontend bugs, so it is worth reading early.

## Why can there only be one React?

React keeps its state in a module-level variable. Hooks work by reading it. If the shell has one copy of React and a remote bundles another, the remote's components call hooks on a copy that is not rendering them.

The result is the error "Invalid hook call". Other packages fail in quieter ways. Two copies of a router or an event bus mean two separate states, and the two halves of the page do not hear each other.

## What is a singleton here?

A singleton is a package that Module Federation loads once and hands to everyone. The shell provides it. A remote declares that it wants the package, and takes the shell's copy instead of bundling its own.

```text
 shell ---- provides ----> [ react 19.3.1 ]  <---- uses ---- catalog
                                  ^
                                  '--------------- uses ---- cart

 one copy in memory, three apps
```

## Which packages are shared?

The presets share a fixed list, for each package the app depends on. The mfeflow packages in it are the ones that keep page-wide state:

```text
react, react/jsx-runtime, react-dom, react-dom/client
react-router, @tanstack/react-query, i18next, react-i18next
@mfeflow/runtime, analytics, telemetry, event-bus,
  storage, theme, i18n (and their /react subpaths)
```

Subpaths such as `react-dom/client` are listed on purpose. Module Federation shares each import path separately, and a missed subpath escaped sharing in a real React 19 bug.

Add your own with the `shared` option of the preset:

```ts title="apps/cart/rsbuild.config.ts"
export default createRemoteConfig({
  name: 'cart',
  exposes: { './App': './src/exposed/App.tsx' },
  shared: ['some-state-library'],
});
```

An extra that cannot be resolved throws, because it is almost always a typo.

## How are versions matched?

Each app asks for `^<the version it installed>`. If the shell's version does not satisfy the range, Module Federation warns and may load a second copy. This is version drift.

pnpm workspaces make it easy to cause drift by accident. Dependencies written as `catalog:` or `workspace:*` give Module Federation no version to read.

The preset reads the installed version instead. The doctor checks that every workspace package has a version (E111).

## How is it checked?

Before you ship, two commands compare your apps:

```bash
pnpm mfeflow doctor
pnpm mfeflow check-compat
```

The first reports a singleton with more than one version across apps (E301). The second reports a remote that needs a range the shell does not satisfy (E302). A remote can state its needs under `platform` in `mfe.json`.

At runtime, `@mfeflow/runtime` can read Module Federation's share scope and list packages that are missing or loaded twice. In a generated project, the shell runs this check in development only, as remotes load. It reports a duplicate or missing React in the console and in the dev panel.

The check is not loaded in production builds, so it costs nothing there. The storefront example's tests also trigger it with `?mfeflow-assert`.

## What should I do as a developer?

- Do not bundle React in a remote. Leave it to the preset.
- Keep versions of shared packages the same in every app. The pnpm `catalog` does this for you.
- Do not import a shared package from a runtime plugin. A plugin runs before the shared scope exists (E303).
- Run `doctor` in CI. See [CI and budgets](/guide/ci-and-budgets).

## Trade-off

Sharing means all apps move to a new React version together, or at least within a compatible range. That is the cost of one working page.
