---
title: How mfeflow works
description: How a shell boots, reads the registry index, registers remotes and loads them, how remotes are built with Rsbuild and Module Federation 2, and how shared singletons are checked.
---

# How mfeflow works

This page explains what happens between a visitor opening the shell and a remote appearing on screen. It also covers how the apps are built and how development differs from production. It is an explanation page, so it has no steps to follow.

## What happens when the shell boots?

The shell's entry file calls `main()` in `bootstrap.tsx`. That function does four things in order. It reads the registry index, applies any development overrides, registers the remotes with Module Federation, and renders the app.

```text
browser opens the shell
        |
        v
  loadRegistryIndex()
        |   window.__MFE_REGISTRY__ set?  --yes-->  use it, no request
        |   no
        v
  GET /registry/index.json   (same origin only, 5 s timeout)
        |
        v
  applyDevOverrides()        (development builds only)
        |
        v
  registerRemotesFromIndex() (skips entries with a bad field or origin)
        |
        v
  loadRuntimeConfig()  -->  render <App />
        |
        v
  route matches /catalog  -->  <RemoteBoundary id="catalog/App">
        |
        v
  Module Federation loads the remote entry, then the exposed module
```

The registry index is a list of remotes with a name and an entry URL. A server or CDN edge can write it into the page as `window.__MFE_REGISTRY__`, which saves one request. Otherwise the shell fetches `/registry/index.json` from its own origin. [The registry index](/concepts/registry-index) describes the format.

Registering does not download anything. A remote's code loads only when a route renders its boundary. That boundary waits up to five seconds, then shows a fallback and reports the failure. The rest of the page keeps working.

## How are the apps built?

Every app uses Rsbuild with the Module Federation 2 plugin. You do not write that configuration. Two functions from `@mfeflow/rsbuild` return it: `createShellConfig` and `createRemoteConfig`.

```text
rsbuild.config.ts                 @mfeflow/rsbuild
-----------------                 ----------------
createRemoteConfig({...})  --->   React plugin
                                  Module Federation plugin
                                    - shared singletons
                                    - manifest (mf-manifest.json)
                                    - generated types (@mf-types.zip)
                                  ESM Module Federation runtime
                                  assetPrefix: 'auto'
```

The presets set these defaults. Each is a decision about cost or safety.

| Setting                       | Remote                                      | Shell                                             |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Shared singletons             | Every default package the app depends on    | The same list, and in the initial chunk (`eager`) |
| Manifest                      | Written as `mf-manifest.json`               | Written                                           |
| Generated types               | On; turn off with `types: false`            | Off in normal builds                              |
| ESM Module Federation runtime | On; turn off with `esmRuntime: false`       | On                                                |
| Module Federation runtime     | Provided by the shell, not bundled          | Provided to remotes                               |
| Remote-loading code           | Removed unless `consumesRemotes` is set     | Not applicable                                    |
| Asset URLs                    | Relative to where the entry loaded (`auto`) | Normal                                            |
| Runtime plugins               | None                                        | Failure reporting and entry retry                 |

Remote names must be lowercase letters, digits and underscores. The preset throws on anything else. A remote must expose at least one module.

## How are shared singletons checked?

A singleton is a package that must exist once per page, such as React. The presets share a fixed list of packages and set a required version from what is installed. [Shared singletons](/concepts/shared-singletons) explains why.

There are two checks. At build and review time, `mfeflow doctor` compares singleton versions across apps (E301). `mfeflow check-compat` compares each remote's ranges with its shell (E302). Both run offline from your files.

At run time, the runtime package has `checkSingletons`, which reads Module Federation's share scope and reports packages that are missing or loaded in more than one version. `assertRequested` turns it on when the page URL has `?mfeflow-assert`. The generated shell does not call these yet. The storefront example in the repository does, in `examples/storefront/shell/src/assert.ts`.

## How does development differ from production?

In development, `mfeflow dev` starts every app and builds a dev registry from `mfeflow.json`. The shell build puts that registry into the HTML as `window.__MFE_REGISTRY__`. Remotes load from their own `localhost` ports.

In production, nothing runs the apps for you. You serve the shell and each remote as static files, and you serve a registry index. The shell expects remotes under `/mfe/<name>/` on its own origin. [Deploy](/guide/deploying) covers what that means today.

```text
development                               production
-----------                               ----------
mfeflow dev                               static hosting
 |- shell     :4300                        |- /            shell files
 |- catalog   :4311                        |- /mfe/catalog remote files
 |- cart      :4312                        |- /mfe/cart    remote files
 '- dev registry (inlined in HTML)         '- /registry/index.json
                                           '- /config/runtime-config.json
```

Overrides exist only in development. Adding `?mfe-override=cart@http://localhost:4312/mf-manifest.json` to the URL points one remote at your local build. See [Develop locally](/guide/development).

## What is in the generated shell?

The shell has a small path-based router in `App.tsx` and a route table. It does not install a router library. You can replace it. Features such as route-factory add typed links.

The generated `App.tsx` also mounts a development-only panel, `DevOverlay`, from the runtime package. It lists the registered remotes and their errors. Press Alt+Shift+M to toggle it.

## Where to go next

- Look at the files: [Project structure](/guide/project-structure).
- Learn the underlying idea: [Module Federation](/concepts/module-federation).
- A build or load failed: [Troubleshooting](/guide/troubleshooting).
