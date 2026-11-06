# @mfeflow/runtime

Runtime for mfeflow shells. It reads the remote registry index and registers each remote with Module Federation, renders remotes inside `RemoteBoundary` (timeout, fallback, error reporting), checks that singletons are really shared, and composes the shell's providers.

## Install

```sh
pnpm add @mfeflow/runtime @module-federation/enhanced react
```

`@module-federation/enhanced` (^2.9.0) and `react` (^19) are peer dependencies.

## Usage

```tsx
import {
  RemoteBoundary,
  loadRegistryIndex,
  registerRemotesFromIndex,
  reportRemoteError,
} from '@mfeflow/runtime';

try {
  registerRemotesFromIndex(await loadRegistryIndex(), { allowedOrigins: [location.origin] });
} catch (error) {
  reportRemoteError('shell', 'registry', error);
}

// A slow, missing or crashing remote shows its fallback; the rest of the page keeps working.
<RemoteBoundary id="cart/App" timeoutMs={5000} loading={<p>Loading</p>} />;
```

`composeProviders([...])` nests providers (first is outermost) and `withProps` binds props to one. `checkSingletons` and `assertRequested` back the `?mfeflow-assert` check. Optional plugins are at `@mfeflow/runtime/plugins/report` and `@mfeflow/runtime/plugins/entry-retry`.

`@mfeflow/runtime/providers` exports `composeProviders` and `withProps` alone, for code that should not load the registry code. `@mfeflow/runtime/beacon` exports `registrySourcesWithBeacon`: when the runtime config has `registryBeacon: true` and an index URL is a registry server's, it adds this browser's id to that URL and reports which remote versions were loaded. Import it on demand (`await import('@mfeflow/runtime/beacon')`) so a shell with the option off never downloads it.

## Module Federation sharing

Bucket: **singleton**. This package keeps page-wide state, so the shell and every remote must use one copy. `@mfeflow/rsbuild` and `@mfeflow/vite` share it as a Module Federation singleton by default (the list is in `@mfeflow/bundler-shared`); if you configure sharing by hand, mark it `singleton: true`. A micro-frontend app must also list `@mfeflow/runtime` in its own dependencies, even if it imports only a company wrapper such as `@acme/runtime`: the presets share the package only when the app can resolve it from its own folder.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
