# Features

mfeflow is built from features. `mfeflow init` applies the defaults and `mfeflow add <feature>` adds one later, with a
diff of every change and a rollback if it fails halfway. `mfeflow features` lists them all.

| Feature                                    | Default | What it adds                                                                |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------- |
| `core`, `tsconfig`                         | always  | The shell, the remotes, the registry and strict TypeScript presets          |
| `lint-oxlint`                              | yes     | oxlint with type-aware rules, and Prettier                                  |
| `url-factory`                              | yes     | Typed endpoint definitions and URL building                                 |
| [`env-t3`](./env-t3)                       | yes     | Typed env that fails the build, runtime-config schema checked before deploy |
| [`testing`](./testing)                     | yes     | Vitest, Testing Library, MSW and a Playwright smoke test                    |
| [`analytics-gtm`](./analytics-gtm)         | no      | Google Tag Manager with Consent Mode v2                                     |
| [`telemetry-otel`](./telemetry-otel)       | no      | OpenTelemetry in the browser, tagged per remote                             |
| [`event-bus`](./event-bus)                 | no      | Typed events between remotes, and the contracts package for them            |
| [`route-factory`](./route-factory)         | no      | Typed links between remotes                                                 |
| [`http`](./http)                           | no      | A fetch client over your endpoints, with retries                            |
| [`theming`](./theming)                     | no      | Light and dark themes as CSS variables, owned by the shell                  |
| [`i18n`](./i18n)                           | no      | Translations, one i18next instance, messages per remote                     |
| [`tailwind`](./tailwind)                   | no      | Tailwind 4 with a class prefix per app                                      |
| [`ui-shadcn`](./ui-shadcn)                 | no      | shadcn/ui in every remote                                                   |
| [`forms`](./forms)                         | no      | react-hook-form with zod, valibot or arktype                                |
| [`data-react-query`](./data-react-query)   | no      | TanStack Query as a shared singleton                                        |
| [`analytics-clarity`](./analytics-clarity) | no      | Microsoft Clarity, after consent                                            |
| [`storybook`](./storybook)                 | no      | Storybook per remote, composed in the shell                                 |
| [`ci-github`](./ci-github)                 | no      | A pull request workflow                                                     |
| `git-hooks`                                | no      | lefthook and commitlint                                                     |
| [`commit-prompt`](./commit-prompt)         | no      | An interactive Conventional Commits prompt                                  |

## Features from other people

Features can also come from a registry anyone hosts, named `@namespace/feature`. They are declarative only (files,
dependencies, script names and a fixed set of built-in edits) and never run code. See
[Third-party features](./third-party) to install one or publish your own.

```sh
mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
mfeflow features segment
mfeflow add @acme/segment
```
