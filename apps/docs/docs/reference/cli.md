---
title: CLI reference
description: Every mfeflow command and flag for version 0.4.0, with the global options, exit codes and the JSON output shapes. Copied from the built command line help.
---

# CLI reference

This page lists every command, flag and exit code of the `mfeflow` command line. It matches `mfeflow --help` for version 0.4.0. For task-based help, use the [guides](/guide/introduction).

In a generated project, run commands as `pnpm mfeflow <command>`. To create a project, use `pnpm create mfeflow`, which runs `init`.

Run the command with `--help` for the options and examples of one command.

## Commands

| Command                                   | Does                                                            |
| ----------------------------------------- | --------------------------------------------------------------- |
| `init [dir]`                              | Create a project: a shell and remotes                           |
| `add remote <name>`                       | Add a remote, its registry entries and a shell route            |
| `add shell <name>`                        | Add a shell that routes to every remote                         |
| `add <feature...>`                        | Add features, or `@namespace/feature` from a registry           |
| `add env-key <KEY>`                       | Add a typed env key                                             |
| `features [search]`                       | List and search features from mfeflow and your registries       |
| `registry add`, `list`, `remove`, `build` | Configure or build third-party registries                       |
| `doctor`                                  | Check singletons, compatibility, config and drift               |
| `validate`                                | Check `mfeflow.json`, every `mfe.json` and every registry entry |
| `check-compat`                            | Check each remote's shared ranges against its shells            |
| `budget`                                  | Measure built JavaScript against the cost model                 |
| `dev`                                     | Run the shell and every remote with a dev registry              |

This release has no command to remove a feature. It also has no upgrade, deploy, promote, rollback or status command.

An unknown command exits with code 2 (E107).

## Global options

Every command accepts these.

| Flag                        | Meaning                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `-y`, `--yes`               | Take the defaults and never prompt                                                    |
| `--preset <file\|url>`      | Replay options from a JSON file or an https URL. Flags win over the preset            |
| `--json`                    | Print one JSON document on stdout and nothing else                                    |
| `--dry-run`                 | Print the summary and diff, write nothing                                             |
| `--cwd <dir>`               | Run as if started in this folder                                                      |
| `--install`, `--no-install` | Run the package manager after writing. On by default                                  |
| `--verbose`                 | Show package manager output and stack traces                                          |
| `--local <path>`            | Link `@mfeflow/*` from a built mfeflow checkout. Environment variable `MFEFLOW_LOCAL` |
| `-h`, `--help`              | Show help                                                                             |

## init

Creates a project.

```bash
mfeflow init [dir] [options]
```

| Flag                     | Type       | Default                                           | Meaning                                  |
| ------------------------ | ---------- | ------------------------------------------------- | ---------------------------------------- |
| `--scope <@scope>`       | text       | from the folder name                              | npm scope for the project packages       |
| `--remotes <a,b>`        | list       | `catalog,cart`                                    | Remotes to create                        |
| `--features <a,b>`       | list       | `lint-oxlint`, `url-factory`, `env-t3`, `testing` | Optional features to turn on             |
| `--package-manager <pm>` | text       | `pnpm`                                            | Only `pnpm` in this release              |
| `--topology <name>`      | text       | `monorepo`                                        | Only `monorepo` in this release          |
| `--option <f.k=v>`       | repeatable | none                                              | A feature option, as `feature.key=value` |

Feature names accepted by `--features`: lint-oxlint, url-factory, env-t3, testing, analytics-gtm, telemetry-otel, event-bus, route-factory, http, theming, i18n, tailwind, ui-shadcn, forms, data-react-query, analytics-clarity, storybook, ci-github, git-hooks, commit-prompt.

```bash
mfeflow init my-app --scope @acme --remotes catalog,cart,checkout --features lint-oxlint,git-hooks
```

## add

Adds an app, features or an env key. Four forms:

```bash
mfeflow add remote <name>
mfeflow add shell <name>
mfeflow add <feature...>
mfeflow add env-key <KEY> --scope server|runtime --schema <expr>
```

| Flag                             | Applies to    | Meaning                                                                                |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `--port <n>`                     | remote, shell | Dev server port. Default: the next free one                                            |
| `--option <f.k=v>`               | features      | A feature option, repeatable                                                           |
| `--scope <server\|runtime>`      | env-key       | `server` writes `env.ts` and `.env.example`. `runtime` writes the runtime config files |
| `--schema <expr>`                | env-key       | The validator expression, such as `z.url()`                                            |
| `--value <text>`                 | env-key       | Placeholder written to the example or config files                                     |
| `--app <name>`                   | env-key       | Only this app. Default: every app, or every shell for `runtime`                        |
| `--group <root\|shell\|remotes>` | env-key       | Root, every shell or every remote, instead of `--app`                                  |

A feature from a registry is written only after a yes at the prompt, or with `--yes`. Without a terminal, `--yes` is required.

```bash
mfeflow add remote checkout --port 4320
mfeflow add env-t3 --option env-t3.validator=valibot
mfeflow add env-key GTM_ID --scope runtime --schema "z.string().min(1)" --app shell
```

## features

Lists and searches features from mfeflow and every configured registry.

```bash
mfeflow features [search]
```

The search matches name, description or keywords. A registry that cannot be read is reported on stderr and the others are still listed. The exit code stays 0.

## registry

Manages third-party feature registries in `mfeflow.json`, or builds one to host.

```bash
mfeflow registry add @namespace <url-template>
mfeflow registry list
mfeflow registry remove @namespace
mfeflow registry build <dir> [--out dir]
```

| Action   | Does                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `add`    | Writes the namespace and URL template to `mfeflow.json`. The template needs `{name}`; `{version}` is optional |
| `list`   | Prints each namespace with its template                                                                       |
| `remove` | Removes it. Refused while a feature from that namespace is installed                                          |
| `build`  | Checks every feature folder in `<dir>` and writes the files to host. Default output `<dir>/dist`              |

The URL must be https. Plain http is accepted for loopback hosts only: localhost, 127.0.0.1 and [::1]. The namespace `@mfeflow` is reserved.

The build action lists every problem and writes nothing if there is one (E404).

## doctor, validate and check-compat

| Command        | Does                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`       | Runs all checks: apps on disk, `mfe.json`, ports, routes, registry, singleton versions, workspace versions, compatibility, drift, runtime plugins and env files |
| `validate`     | Apps on disk, `mfe.json`, routes and registry entries                                                                                                           |
| `check-compat` | Remote ranges against their shells                                                                                                                              |

`doctor --fix` repairs a missing workspace version (E111) and missing registry entry files (E114). Add `--dry-run` to see the diff first.

## budget

Measures the built JavaScript of the shell and each remote against the cost model. Build first.

| Flag           | Default | Meaning                             |
| -------------- | ------- | ----------------------------------- |
| `--dist <dir>` | `dist`  | Build output folder inside each app |

See [CI and budgets](/guide/ci-and-budgets) for what it checks and [The cost model](/concepts/cost-model).

## dev

Runs the shell and every remote with a dev registry that follows the project.

| Flag                      | Meaning                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `--only <a,b>`            | Run only these apps. Default: the shell and every remote                                       |
| `--remote <name=url>`     | Use a server you already run for a remote. Repeatable. A bare origin means `/mf-manifest.json` |
| `--allow-origin <origin>` | Allow `--remote` to point at this origin. Localhost is always allowed. Repeatable              |

Ctrl+C stops everything and exits with code 130. See [Develop locally](/guide/development).

## Exit codes

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | Success                                   |
| 1    | Unexpected error                          |
| 2    | Bad command line (E107, E215)             |
| 3    | Project or config problem (E1xx)          |
| 4    | Feature problem (E2xx)                    |
| 5    | Build or runtime problem (E3xx)           |
| 6    | Registry problem (E4xx)                   |
| 7    | Upgrade problem (E5xx)                    |
| 130  | Cancelled at a prompt, or Ctrl+C in `dev` |

For the four check commands, the exit code is the lowest code among the errors found. Warnings do not change it. Every error has a code and a page. See [Error codes](/reference/errors).

## Output and exit codes

With `--json`, a command prints one JSON document and nothing else. An error prints a failure document:

```json
{
  "ok": false,
  "error": {
    "code": "MFEFLOW_E102",
    "message": "...",
    "fix": "...",
    "docs": "https://mfeflow.github.io/mfeflow/errors/E102"
  },
  "exitCode": 3
}
```

The success documents have these shapes. Each has `ok` and `command`.

| Command                              | Main fields                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `init`                               | `dryRun`, `root`, `plan`, `written`, `installed`, `scope`, `apps`, `next`, `diff` on a dry run                        |
| `add`                                | The same as `init`, plus `kind`, `added` and `skipped`                                                                |
| `features`                           | `search`, `features[]` (`source`, `name`, `version`, `description`, `always`, `default`, `installed`), `registries[]` |
| `registry`                           | `action`, `dryRun`, `root`, `changed`, `registries[]`, `build`                                                        |
| `doctor`, `validate`, `check-compat` | `root`, `summary` (`errors`, `warnings`, `skipped`, `fixed`), `checks[]`, `findings[]`                                |
| `budget`                             | `root`, `model`, `shells[]`, `remotes[]`, `findings[]`                                                                |
| `dev`                                | `root`, `registry`, `apps[]`, `overrides`, `dryRun`, `interrupted`                                                    |

The plan in the `init` and `add` output lists features, changes (path and action), dependencies, scripts and warnings. Output shapes are part of the public API. See [Versions and upgrades](/guide/upgrading).
