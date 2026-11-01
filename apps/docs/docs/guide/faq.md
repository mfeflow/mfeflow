---
title: FAQ
description: Honest answers to the common questions about mfeflow, including duplicate React, shell and remote versions, CSS isolation, SSR, Next.js, Vite, npm and Yarn, and what is not built yet.
---

# FAQ

This page answers the questions people ask most. Where mfeflow does not solve something yet, the answer says so.

## Do I need micro-frontends at all?

Often not. They pay off when several teams need to ship parts of one front end on their own schedules. For one team and one release train, a single app is simpler. [Why try mfeflow](/guide/why-mfeflow) has a short checklist.

## How do I stop two copies of React?

Share React as a singleton. The Rsbuild presets do this for React, React DOM and the mfeflow packages. `mfeflow doctor` fails when versions differ across apps, or when a workspace package has no version, which silently stops sharing. See [Shared singletons](/concepts/shared-singletons).

## What if the shell and a remote use different versions?

The remote asks for a range based on what it installed, and the shell provides its own copy. `mfeflow check-compat` compares them and reports a mismatch. A remote can also declare the ranges it needs under `platform` in its `mfeflow.app.json`. See [CI and budgets](/guide/ci-and-budgets).

## What does "Failed to get remoteEntry exports" mean?

The browser could not load the remote's entry script. The causes are a wrong URL, a remote that is down, or a CORS block. The fix steps are in [Troubleshooting](/guide/troubleshooting#failed-to-get-remoteentry-exports).

## What does "Invalid hook call" mean here?

Almost always two copies of React. See the second question above and [Troubleshooting](/guide/troubleshooting#invalid-hook-call).

## How does the shell find a remote?

At boot it reads a registry index, a JSON list of remotes with their entry URLs. In development the index comes from your project. In production you serve it. See [The registry index](/concepts/registry-index).

## Can I deploy or roll back one remote without redeploying the shell?

You can deploy one remote on its own today. Replace its files under `/mfe/<name>/`, and the shell loads the new build the next time a visitor opens the page. Rollback is manual: put the old files back.

A command that rolls back by changing a pointer, with no rebuild, is planned and not built. See [Deploy](/guide/deploying).

## Who owns the contracts between remotes?

Each app names an owner in its `mfeflow.app.json`. Shared types, such as event payloads, live in a contracts package that the event-bus feature creates. Teams review changes to it like any other code. See [Ownership](/concepts/ownership).

## How does routing between the shell and remotes work?

The shell owns the URL. It has a route table that maps paths to remotes. Each remote claims its routes in `mfeflow.app.json`, and `validate` fails when two remotes claim overlapping paths. The route-factory feature gives typed links between remotes. See [route-factory](/features/route-factory).

## How do remotes share state or talk to each other?

Through typed events, not shared imports. The event-bus feature gives a small bus and a contracts package for the event types. A remote must not import from another remote. See [event-bus](/features/event-bus).

## How do I isolate CSS between remotes?

mfeflow does not isolate CSS by itself. The tailwind feature gives each app a class prefix and puts the reset in the shell only, which avoids the common collisions. Plain CSS files are not scoped. There is no Shadow DOM support. See [tailwind](/features/tailwind).

## How do I keep the UI consistent across teams?

The theming feature gives every remote the same color and spacing variables, owned by the shell. The ui-shadcn feature copies components into each remote, so nothing is shared between them at runtime. See [theming](/features/theming).

## Can remotes use different frameworks?

No. The singleton design and the runtime assume one React version. Other frameworks are not supported.

## How do I run one remote locally against a deployed system?

Run your local shell against a remote that is already running somewhere, with `mfeflow dev --remote`. The other direction, loading your local remote into a deployed shell, works only if that shell is a development build, because overrides are disabled in production builds. See [Develop locally](/guide/development).

## How do I type imports across remotes?

Remote builds produce type files, and the shell can typecheck against them. In practice, remotes should not import each other. Share types through the contracts package, and use typed events and links. The generated shell does not turn on remote type checking by default.

## Can I use npm or Yarn?

No. This release supports pnpm only. The generated project depends on pnpm workspaces and the pnpm `catalog`. The `--package-manager` flag accepts only `pnpm`.

## Can I use Next.js?

No. mfeflow builds client-rendered React apps with Rsbuild. Next.js is not supported.

## Does it support server-side rendering?

Not yet. The shell and remotes render in the browser. A server or CDN edge can inline the registry into the HTML and add preload hints, but that is not server-side React rendering.

## Can I use Vite?

No. The presets are for Rsbuild and its Module Federation plugin. Vite is not supported.

## Can I use separate repositories for each remote?

Not yet. This release creates a monorepo only.

The project file has room for polyrepo and hybrid layouts, but the CLI accepts only `monorepo` today.

## Is there a command to remove a feature?

No. Delete its files and dependencies by hand. See [Add features](/guide/adding-features).
