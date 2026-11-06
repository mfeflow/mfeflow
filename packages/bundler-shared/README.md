# @mfeflow/bundler-shared

The bundler-agnostic half of the mfeflow presets. `@mfeflow/rsbuild` and `@mfeflow/vite` both build on it, so a shell or remote shares the same singletons, Module Federation options, head scripts and runtime config whichever bundler builds it.

You rarely install it yourself: the presets depend on it and re-export what an app needs (`registerHeadScript`, `DEFAULT_SINGLETONS`, the runtime config helpers).

## What is in it

- `DEFAULT_SINGLETONS`, `sharedSingletons`: the packages every mfeflow app shares once.
- `commonRemoteOptions`, `commonShellOptions`: Module Federation options before bundler-specific settings.
- `registerHeadScript`, `headScripts`: inline scripts the shell runs first in `<head>`.
- `runtimeConfigHandler`, `runtimeConfigEnv`: serve `/config/runtime-config.json` in dev and preview.

## Module Federation sharing

Bucket: **config**. Used at build, lint or test time only, never shipped to the browser, so it is not shared through Module Federation.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
