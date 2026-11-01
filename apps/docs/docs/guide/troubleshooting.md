---
title: Troubleshooting
description: Find a Module Federation, runtime or mfeflow CLI error by its exact text, with the cause and the fix for each, and links to the numbered error pages.
---

# Troubleshooting

This page lists errors by the text you see, with the cause and the fix. Search the page for your message. Each runtime failure is also printed to the browser console as `[mfeflow] <remote> <where>: <message>`. When the registry gave a version, the remote shows as `cart@1.2.3`.

## Browser errors

### Failed to get remoteEntry exports

The browser could not load or run the remote's entry script. The shell registered the remote, but its file did not arrive or did not define the expected container.

Check these in order:

1. Open the remote's `mf-manifest.json` URL from the registry in the browser. A 404 means the remote is not running or the URL is wrong.
2. Look at the Network tab for the entry script. A CORS error means the remote must allow the shell's origin.
3. In production, check that the `entry` in the registry matches where the files really are, such as `/mfe/cart/`.

The shell retries a failed entry twice, with a short growing delay. If it still fails, the remote shows its fallback and the failure appears in the console. Start `pnpm mfeflow dev`, which also starts the remotes.

### Invalid hook call

React reports "Invalid hook call. Hooks can only be called inside of the body of a function component". With micro-frontends, the usual cause is two copies of React on the page. The remote used its own copy instead of the shell's.

Run the doctor:

```bash
pnpm mfeflow doctor
```

Look for E301, a singleton with more than one version, and E111, a workspace package with no `version`. A package with no version is never shared, so every app loads its own copy. `doctor --fix` writes the missing version. Then rebuild. See [Shared singletons](/concepts/shared-singletons).

### Shared module is not available for eager consumption

The shell was built with `eager: false`, but its entry runs the app code directly. Either make the shell's entry file do only a dynamic import of the bootstrap file, or remove the option.

The generated shell uses the default, which avoids this.

### Nothing at /cart

The shell shows "Nothing at /cart." when no route matches the path. Open `apps/shell/src/remotes/route-table.tsx` and check that the remote has an entry. `mfeflow add remote` adds one.

## Messages from the runtime

### MFE_INVALID_REMOTE

The message reads `"cart" is skipped, its <field> is invalid`. One entry in the registry index has a bad field, such as an `entry` that is not an http(s) URL. The shell skips that remote and loads the others. Fix the field named in the message, then run `pnpm mfeflow validate`. See the [registry index](/concepts/registry-index).

### MFE_NO_REMOTE_ENTRY

A registry entry has only a manifest URL, and the shell was built without the manifest loader. Production shell builds drop that loader by default to stay small. Either publish the remote's `remoteEntry` in the index, or build the shell with `snapshot: true`. The generated shell already sets `snapshot: true`.

### MFE_REGISTRY_FALLBACK

The primary registry index failed and a later URL served the shell. The message names the first failure and the URL that worked, such as `registry index /registry/index.json: HTTP 503; using https://cdn.example.com/...`. The page works, but your primary source is down. Fix it before the fallback fails too. The URLs come from `registryUrls` in the runtime config.

### registry index ...: must be same-origin or in allowedOrigins

An index URL is on an origin the shell does not trust. By default it may only be on the shell's own origin. Serve the index from the same host, list its origin in `registryOrigins` in the runtime config, or write the index into the page as `window.__MFE_REGISTRY__`.

### registry index ...: HTTP 404

The shell asked for the index and the server had none. In production you must serve `/registry/index.json`. See [Deploy](/guide/deploying).

### origin ... is not allowed

A registry entry points to an origin the shell does not trust. In production the generated shell allows only its own origin. Put the remote under `/mfe/<name>/` on the shell's host.

### timed out after 5000 ms

A remote took longer than five seconds to load. The shell shows "cart is unavailable right now." and keeps the rest of the page. Pass `timeoutMs` to the remote boundary if a slow link needs more.

### getRuntimeConfig() was called before the shell loaded the runtime config

Code read the runtime config before the shell fetched it. Read it after boot, not at module load. See [Runtime config](/concepts/runtime-config).

### overrides are disabled in this build

You used `?mfe-override=` on a production build. Overrides work only in development builds. See [Develop locally](/guide/development).

## Build-time errors

### is not a valid Module Federation name

The remote name has characters Module Federation cannot use. Use lowercase letters, digits and underscores, starting with a letter. The same applies to a remote that exposes nothing: add at least one entry to `exposes`.

### MFE_ENV=... has no public/config/runtime-config...json

The dev server answers `/config/runtime-config.json` with the file for the environment named in `MFE_ENV`. The default is `dev`. Create the file for that environment, or unset the variable.

## CLI errors

The CLI prints a code like `MFEFLOW_E102`, the cause, a fix, and a link. These are the ones people meet first.

| You see                                       | Code | Fix                                                    |
| --------------------------------------------- | ---- | ------------------------------------------------------ |
| No mfeflow.json found                         | E102 | Run the command in the project, or pass `--cwd`        |
| A command-line option is missing or not valid | E107 | Run the command with `--help`                          |
| The target folder is not empty                | E108 | Use a new or empty folder                              |
| A workspace package has no version            | E111 | `mfeflow doctor --fix`                                 |
| Two apps use the same port                    | E115 | Change a port in `mfeflow.json` and the app            |
| Two remotes claim routes that overlap         | E116 | Give each remote its own route                         |
| Feature needs another feature first           | E206 | Add the required feature first, or in the same command |
| A singleton resolves to more than one version | E301 | Use one version in every app                           |
| A bundle is over its budget                   | E304 | See [CI and budgets](/guide/ci-and-budgets)            |
| There is no build output to measure           | E305 | Run `pnpm build` first                                 |
| A dev server could not start                  | E306 | Run `pnpm install`, or free the port                   |

Every code has its own page. Browse the full list in [Error codes](/reference/errors).

## Harmless dev messages

When a remote starts, Module Federation prints a note that CORS options are not set. In development it adds permissive headers for you. Set an allowlist before you expose a dev server to a network.
