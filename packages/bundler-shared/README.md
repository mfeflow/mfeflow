# @mfeflow/bundler-shared

The bundler-agnostic half of the mfeflow presets. `@mfeflow/rsbuild` and `@mfeflow/vite` both build on it, so a shell or remote shares the same singletons, Module Federation options, head scripts and runtime config whichever bundler builds it.

Most apps never import it directly: the presets depend on it and re-export what an app needs (`registerHeadScript`, `DEFAULT_SINGLETONS`, the runtime config helpers). It is for people writing a preset for another bundler.

## What is in it

- `DEFAULT_SINGLETONS`, `sharedSingletons`: the packages every mfeflow app shares once.
- `commonRemoteOptions`, `commonShellOptions`: Module Federation options before bundler-specific settings.
- `sharedPackages`, `packageNameOf`, `resolvableFrom`, `installedVersionFrom`: which singletons an app can resolve, and at what version.
- `shellDefines`, `snapshotEnabled`: the build-time constants the shell reads (`__MFEFLOW_SNAPSHOT__`, `__MFEFLOW_APP_VERSION__`, `__MFEFLOW_SINGLETONS__`).
- `assertAsyncBoundary`, `checkName`, `appVersion`: checks and helpers the presets run.
- `registerHeadScript`, `headScripts`: inline scripts the shell runs first in `<head>`.
- `runtimeConfigHandler`, `runtimeConfigEnv`: serve `/config/runtime-config.json` in dev and preview.

The shell option `snapshot` keeps the manifest and snapshot loader. It defaults to on outside production builds, where dev overrides point at a local remote's manifest, and off in production, where the shell registers remote entry URLs. Pass `snapshot: true` while publishing does not yet write `remoteEntry`; otherwise the runtime refuses a registry entry that has only a manifest URL (`MFE_NO_REMOTE_ENTRY`).

## Module Federation sharing

Bucket: **config**. Used at build, lint or test time only, never shipped to the browser, so it is not shared through Module Federation.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
