---
title: Module Federation
description: What Module Federation is, how a host loads code from a remote at runtime, the terms you meet in mfeflow, and the trade-offs of splitting a front end this way.
---

# Module Federation

This page explains the idea mfeflow is built on. Read it if you have never set up Module Federation. You do not need it to follow the Quickstart.

## What problem does it solve?

Normally a bundler combines all your code at build time. If two teams own two parts of a page, they must build together and release together. A change in one forces a rebuild of the whole.

Module Federation moves the join from build time to runtime. A page can load a piece of code from another build, served from another URL, while the page is open. The pieces are built and deployed on their own.

## How does it work?

There are two roles. The host is the app the visitor opens. A remote is a separate build that exposes some modules. The host does not contain the remote's code. It knows where to find it.

```text
   build time                         runtime (in the browser)

 host build  ----> host files  --->  host page
 remote build ---> remote files       |  needs "cart/App"
        (separate deploy)             v
                                  fetch cart's entry script
                                      |
                                      v
                                  run it, get the App module
                                      |
                                      v
                                  render it inside the host page
```

In mfeflow the host is called the shell. A remote lists what it exposes, such as `./App`.

The shell asks for `cart/App`. That means the `./App` module of the remote named cart.

## What are the terms?

| Term          | Meaning                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| Host (shell)  | The app that loads first and loads others                                                   |
| Remote        | A separate build with exposed modules                                                       |
| Expose        | A module a remote offers, such as `./App`                                                   |
| Manifest      | `mf-manifest.json`, a file that describes a remote's files and what it exposes              |
| Remote entry  | The small script that starts a remote and hands over its modules                            |
| Shared module | A package both sides use, loaded once. See [Shared singletons](/concepts/shared-singletons) |

## What does it look like in code?

A remote exposes a module in its config. In mfeflow that is one preset call:

```ts title="apps/cart/rsbuild.config.ts"
import { createRemoteConfig } from '@mfeflow/rsbuild';

export default createRemoteConfig({
  name: 'cart',
  port: 4312,
  exposes: { './App': './src/exposed/App.tsx' },
});
```

The shell renders the remote inside a boundary. The boundary shows a fallback if the remote is slow or broken:

```tsx title="apps/shell/src/remotes/cart.tsx"
import { RemoteBoundary } from '@mfeflow/runtime';

export function CartRoute() {
  return <RemoteBoundary id="cart/App" loading={<p>Loading cart…</p>} />;
}
```

## How does the shell know where a remote is?

Plain Module Federation puts remote URLs in the host's build config. Then changing a URL means rebuilding the host. mfeflow registers remotes at runtime from a list the shell reads at boot. See [The registry index](/concepts/registry-index).

## What are the trade-offs?

You gain independent deploys and team autonomy. You pay with more moving parts.

- Every page load makes extra requests for remote files. The [cost model](/concepts/cost-model) sets a budget for that.
- Shared packages need care. Two copies of React break hooks.
- A remote can fail while the shell is fine. The shell must handle that, which the boundary does.
- Types and contracts between teams need an owner.

If the first gain does not matter to you, you probably do not need this. See [Why try mfeflow](/guide/why-mfeflow).

## Which version does mfeflow use?

Module Federation 2, through the Rsbuild plugin, with its ESM runtime. Build details are in [How it works](/guide/how-it-works). The official documentation is at module-federation.io.
