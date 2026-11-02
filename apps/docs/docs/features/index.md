---
title: Feature catalog
description: Every mfeflow feature in one table, with what it adds, whether it is on by default, which package it uses and which files you own after adding it.
---

# Feature catalog

This page helps you choose features. A feature is a reviewed set of file changes you add with one command. After you add it, the files are yours to edit.

## Which features are on by default?

A new project has the always-on features and the four default ones. Add any other one later with this command:

```bash
pnpm mfeflow add analytics-gtm
```

See [Add features](/guide/adding-features) for the preview, options and rollback. List what your project can add with `pnpm mfeflow features`.

## What can I add?

The Package column is the library that runs in the browser or at build time. The last column is code that is written into your project, which you own and edit.

| Feature                                          | Status    | What it adds                                               | Package                  | Code you own                          |
| ------------------------------------------------ | --------- | ---------------------------------------------------------- | ------------------------ | ------------------------------------- |
| [tsconfig](/features/tsconfig)                   | Always on | Strict TypeScript 7 presets and a typecheck script         | `@mfeflow/tsconfig`      | `tsconfig.json` in each app           |
| [lint-oxlint](/features/lint-oxlint)             | Default   | Type-aware linting and Prettier                            | `@mfeflow/oxlint-config` | `.oxlintrc.json`, `.prettierrc.json`  |
| [url-factory](/features/url-factory)             | Default   | Typed endpoint definitions and URL building                | `@mfeflow/url-factory`   | `src/api/endpoints.ts` per app        |
| [env-t3](/features/env-t3)                       | Default   | Typed env that fails the build, and runtime config checks  | t3-env                   | `env.ts`, config schema, config files |
| [testing](/features/testing)                     | Default   | Vitest, Testing Library, MSW and a Playwright smoke test   | `@mfeflow/testing`       | Tests, mocks and configs              |
| [analytics-gtm](/features/analytics-gtm)         | Opt in    | Google Tag Manager with Consent Mode v2                    | `@mfeflow/analytics`     | Consent banner, tracker per remote    |
| [analytics-clarity](/features/analytics-clarity) | Opt in    | Microsoft Clarity, loaded after consent                    | `@mfeflow/analytics`     | Config key only                       |
| [telemetry-otel](/features/telemetry-otel)       | Opt in    | OpenTelemetry in the browser, tagged per remote            | `@mfeflow/telemetry`     | Start-up wiring                       |
| [event-bus](/features/event-bus)                 | Opt in    | Typed events between remotes and a contracts package       | `@mfeflow/event-bus`     | `packages/contracts`, event files     |
| [route-factory](/features/route-factory)         | Opt in    | Typed links between remotes                                | `@mfeflow/route-factory` | `src/routes.ts` per remote            |
| [http](/features/http)                           | Opt in    | A fetch client over your endpoints, with retries           | `@mfeflow/http`          | `src/api/client.ts` per app           |
| [theming](/features/theming)                     | Opt in    | Light and dark themes as CSS variables, owned by the shell | `@mfeflow/theme`         | Theme provider wiring                 |
| [i18n](/features/i18n)                           | Opt in    | One i18next instance, messages per remote                  | `@mfeflow/i18n`          | Messages, language switcher           |
| [tailwind](/features/tailwind)                   | Opt in    | Tailwind 4 with a class prefix per app                     | Tailwind                 | Stylesheets, PostCSS config           |
| [ui-shadcn](/features/ui-shadcn)                 | Opt in    | shadcn/ui components in every remote                       | shadcn/ui, copied        | Components in each remote             |
| [forms](/features/forms)                         | Opt in    | react-hook-form with zod, valibot or arktype               | react-hook-form          | An example form per remote            |
| [data-react-query](/features/data-react-query)   | Opt in    | TanStack Query as a shared singleton                       | TanStack Query           | Provider and sample query             |
| [storybook](/features/storybook)                 | Opt in    | Storybook per remote, composed in the shell                | Storybook 10             | Stories and config                    |
| [registry-server](/features/registry-server)     | Opt in    | Publish through a registry server                          | none                     | `src/registry-sources.ts`             |
| [deploy-cloudflare](/features/deploy-cloudflare) | Opt in    | One way to host on Cloudflare Workers                      | wrangler                 | `wrangler.jsonc`, `_headers`, script  |
| [ci-github](/features/ci-github)                 | Opt in    | A pull request workflow                                    | none                     | `.github/workflows/ci.yml`            |
| [git-hooks](/features/git-hooks)                 | Opt in    | lefthook and commitlint                                    | lefthook, commitlint     | `lefthook.yml`, commitlint config     |
| [commit-prompt](/features/commit-prompt)         | Opt in    | An interactive Conventional Commits prompt                 | czg                      | Script and config                     |
| [registry-static](/features/registry-static)     | Opt in    | Deploy and roll back remotes on a folder or bucket         | none                     | Scripts, guide, deploy workflow       |
| [release](/features/release)                     | Opt in    | Changesets versions each remote, and deploy uses it        | Changesets               | `.changeset/`, releasing guide        |

The always-on `core` feature is the shell, the remotes and the registry files. It has no page of its own. See [Project structure](/guide/project-structure).

## What does a feature page contain?

Every page follows the same order: what you get, how to add it, how to use it, the settings, how it works, the gotchas and links.

## Can other people publish features?

Yes. A feature can come from a registry that anyone hosts, named `@namespace/feature`. These features are data only. They list files, dependencies, script names and a fixed set of edits, and they never run code.

```bash
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
pnpm mfeflow add @acme/segment
```

Read [Third-party features](/features/third-party) for the guide, or the [overview](/concepts/third-party-features).
