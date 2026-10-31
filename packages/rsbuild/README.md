# @mfeflow/rsbuild

Rsbuild presets for Module Federation 2.0 micro-frontends. `createShellConfig` and `createRemoteConfig` return an Rsbuild config with React, the shared singletons, the manifest, generated types and the ESM Module Federation runtime already set up.

## Install

```sh
pnpm add -D @mfeflow/rsbuild @rsbuild/core
```

`@rsbuild/core` (^2.0.0) is a peer dependency.

## Usage

```ts
// rsbuild.config.ts of a remote
import { createRemoteConfig } from '@mfeflow/rsbuild';

export default createRemoteConfig({
  name: 'cart',
  port: 4312,
  exposes: { './App': './src/exposed/App.tsx' },
});
```

```ts
// rsbuild.config.ts of the shell
import { createShellConfig } from '@mfeflow/rsbuild';

export default createShellConfig({ name: 'storefront', port: 4300 });
```

Merge extra settings with `mergeRsbuildConfig` from `@rsbuild/core`. `shared: ['some-lib']` adds more singletons. With `eager: false` the shell entry must only `import('./bootstrap')`, and the preset throws if it does not.

## Module Federation sharing

Bucket: **config**. Used at build, lint or test time only, never shipped to the browser, so it is not shared through Module Federation.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [mfeflow.dev](https://mfeflow.dev) (documentation, coming soon)

MIT licensed.
