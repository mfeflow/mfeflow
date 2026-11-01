---
title: CLI reference
description: Every mfeflow command and flag for version 0.4.0, with the global options, exit codes and the JSON output shapes. Copied from the built command line help.
---

# CLI reference

This page lists every command, flag and exit code of the `mfeflow` command line. It matches `mfeflow --help` for version 0.4.0. For task-based help, use the [guides](/guide/introduction).

In a generated project, run commands as `pnpm mfeflow <command>`. To create a project, use `pnpm create mfeflow`, which runs `init`.

Run the command with `--help` for the options and examples of one command.

## Commands

| Command                                          | Does                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `init [dir]`                                     | Create a project: a shell and remotes                                            |
| `add remote <name>`                              | Add a remote, its registry entries and a shell route                             |
| `add shell <name>`                               | Add a shell that routes to every remote                                          |
| `add <feature...>`                               | Add features, or `@namespace/feature` from a registry                            |
| `add env-key <KEY>`                              | Add a typed env key                                                              |
| `upgrade`                                        | Move the project to the version of mfeflow you run, keeping your edits           |
| `features [search]`                              | List and search features from mfeflow and your registries                        |
| `registry add`, `list`, `remove`, `build`        | Configure or build third-party registries                                        |
| `doctor`                                         | Check singletons, compatibility, config and drift                                |
| `validate`                                       | Check `mfeflow.json`, every `mfeflow.app.json` and every registry entry          |
| `check-compat`                                   | Check each remote's shared ranges against its shells                             |
| `budget`                                         | Measure built JavaScript against the cost model                                  |
| `dev`                                            | Run the shell and every remote with a dev registry                               |
| `deploy <remote>`                                | Upload a remote's build to a static registry host and point an environment at it |
| `promote <remote>`                               | Point one environment at the version another serves; no upload                   |
| `rollback <remote>`                              | Point an environment back at an earlier version; no rebuild                      |
| `status`                                         | What each environment serves, the version before it, and drift                   |
| `rollout step\|complete\|abort\|status <remote>` | Move or read a percentage rollout (registry server only)                         |
| `kill <remote>`, `restore <remote>`              | Take a remote out of the served index, or put it back (registry server only)     |

This release has no command to remove a feature.

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

## upgrade

Moves the project to the version of mfeflow you run. It never asks npm for a newer one. The tutorial is in [Versions and upgrades](/guide/upgrading).

```bash
mfeflow upgrade [--to <version>] [--dry-run] [--json] [--yes] [--accept <path|all>] [--keep <path|all>]
```

| Flag                       | Meaning                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--dry-run`                | Print the summary and every diff, write nothing                                                              |
| `--accept <path\|all>`     | Replace a file you changed with the new version. A path, a comma list, or `all`. Symlinks are never replaced |
| `--keep <path\|all>`       | Keep your file. It is raised again only when the new version of it changes                                   |
| `--yes`                    | Never ask. A changed file still needs `--accept` or `--keep`, and a registry feature is applied              |
| `--accept-changed-content` | Take a registry feature whose content differs from the recorded hash                                         |
| `--to <version>`           | Must be the version that runs, because the files come from it. Anything else is E107                         |

A generated file you did not edit is replaced and a new file is created. `package.json`, `pnpm-workspace.yaml` and `turbo.json` only get small edits. Files the new version no longer makes, and files you deleted, are listed and left alone. A file you changed is offered only when the new version generates something different from the old one. It is never written unless you accept it.

Without a terminal there is nobody to ask. A changed file with no decision stops the run before anything is written, with E604 and exit code 8, even with `--yes`. A `--dry-run` never fails that way: it prints everything and exits 0. A symlink is reported and never written over, with or without `--accept all`. It needs no decision and never blocks a run.

A feature from a registry is applied only after you confirm in a terminal, or pass `--yes` without one. The content of each registry feature is compared with the hash in `mfeflow.json`. If the registry now serves other bytes for the same version, the run stops with E406. Pass `--accept-changed-content` to take them. The files are written all or nothing, and the install runs in the same step.

`--json` prints `{ ok, command: "upgrade", dryRun, root, from, fromSource, to, upToDate, replaced, created, edited, diverged: [{ path, reason, decision, lostKeys, diff }], missing, removed, migrations, plan, written, installed, diff }`.

## doctor, validate and check-compat

| Command        | Does                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`       | Runs all checks: apps on disk, `mfeflow.app.json`, ports, routes, registry, singleton versions, workspace versions, compatibility, drift, runtime plugins and env files |
| `validate`     | Apps on disk, `mfeflow.app.json`, routes and registry entries                                                                                                           |
| `check-compat` | Remote ranges against their shells                                                                                                                                      |

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

## deploy, promote, rollback and status

```sh
mfeflow deploy catalog --env prod --version 1.4.2
mfeflow promote catalog --from staging --to prod
mfeflow rollback catalog --env prod --to 1.3.0
mfeflow status --env prod
```

A walk-through with output is in [Deploy and roll back a remote](/guide/deploy-and-rollback).

| Flag                         | Commands                  | Does                                                                                                      |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--env <env>`                | deploy, rollback, status  | The environment. `status` defaults to every env on the host and every folder in `registry/envs` but `dev` |
| `--from <env>`, `--to <env>` | promote                   | Copy the pointer from one environment to another                                                          |
| `--to <version>`             | rollback                  | Go back to this version, which must be in the history. Default: the previous one                          |
| `--force`                    | rollback                  | Roll back although the schema, route or compat checks fail. The files must still exist                    |
| `--version <v>`              | deploy                    | Default: the remote's `package.json` version                                                              |
| `--dist <dir>`               | deploy                    | Build folder inside the remote. Default `dist`                                                            |
| `--no-publish`               | deploy                    | Upload the files, leave the index where it is. `status` then shows drift                                  |
| `--host <spec>`              | all                       | `file:<dir>` or `s3://<bucket>[/prefix]`. Default `registry.host` in `mfeflow.json`                       |
| `--base-url <url>`           | deploy, promote, rollback | https URL (http only on localhost) the host serves from. Default `registry.baseUrl`                       |
| `--shell-manifest <file>`    | deploy, promote, rollback | The shell's deployed `mf-manifest.json`. Default `envs/<env>/shell/` on the host                          |

S3 settings come from `MFEFLOW_S3_ENDPOINT`, `MFEFLOW_S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`, and are never printed. `--dry-run` prints the plan as data and writes nothing. Without `--yes`, a terminal asks before anything moves. A failed gate exits with 7 and one of E501 to E505. The other deploy errors are E506 to E512.

`--json` prints `{ ok, command, dryRun, env, fromEnv, host, remote, version, servedBefore, published, previous, rolledBackFrom, uploads, uploaded, skipped, localEntry, warnings, findings }` for the first three, with `index` added for a dry run. `status` prints `{ ok, command: "status", host, envs: [{ env, published, generatedAt, remotes }], findings }`. A successful deploy, promote or rollback also writes `registry/envs/<env>/<remote>.json`, so git records what is served. Not for `dev`: `mfeflow dev` reads that folder.

## Server mode

Set `MFEFLOW_REGISTRY_URL`, or pass `--registry-url`, and `deploy`, `promote`, `rollback` and `status` talk to a [registry server](/guide/deploy/registry-server-runbook) instead of writing a static index. Without it nothing changes.

```sh
export MFEFLOW_REGISTRY_URL=https://registry.example.com
export MFEFLOW_REGISTRY_TOKEN=...
mfeflow deploy catalog --env prod --percent 10 --steps 50,100
mfeflow rollout status catalog --env prod
mfeflow rollout complete catalog --env prod
mfeflow kill catalog --env prod --reason "payments error"
```

| Flag or variable                 | Commands            | Does                                                                                          |
| -------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `MFEFLOW_REGISTRY_URL`           | all five            | The server address. https, or http on localhost only. No login, query or fragment in it       |
| `--registry-url <url>`           | all five            | The same, and it wins over the variable                                                       |
| `MFEFLOW_REGISTRY_TOKEN`         | all but `status`    | The token. Read only from the environment; there is no flag. Never printed                    |
| `--percent <n>`, `--steps <a,b>` | deploy, promote     | Start a rollout at `n` percent (1 to 99), then the rising steps. A static host refuses (E505) |
| `--reason <text>`                | kill, rollout abort | Written to the audit log                                                                      |

In server mode `deploy` still uploads the build to `--host` first, because the server never stores files. Then it asks the server to move the pointer. `promote --percent` sends the rollout with the promote, so it needs `promote` on the target and `read` on the source, and it is audited as a promote. `status` needs `--env` outside a project, and shows kills and rollouts when a token is set.

`--json` and `--dry-run` work as in static mode. A dry run reads the index and sends nothing, so the server's own checks do not run. Server answers map to the same codes: a missing version or rollout is E508, a changed published version is E511, a missing build file is E509, a lost race is E510, and an unreachable server, a bad token or a missing token is E506. All exit with 7.

## Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Success                                               |
| 1    | Unexpected error                                      |
| 2    | Bad command line (E107, E215)                         |
| 3    | Project or config problem (E1xx)                      |
| 4    | Feature problem (E2xx)                                |
| 5    | Build or runtime problem (E3xx)                       |
| 6    | Feature registry problem (E4xx)                       |
| 7    | Deploy problem (E5xx)                                 |
| 8    | Upgrade problem, or files that need a decision (E6xx) |
| 130  | Cancelled at a prompt, or Ctrl+C in `dev`             |

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
