# CLI reference

`mfeflow <command> --help` prints the options of one command with examples. Every command takes the
[global flags](#flags-on-every-command).

| Command                                                            | Does                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`mfeflow init [dir]`](#init)                                      | New project: a shell, remotes (default `catalog`, `cart`), pnpm workspace, Turborepo |
| [`mfeflow add remote <name>`](#add)                                | New remote with its registry entries and a route in every shell                      |
| [`mfeflow add shell <name>`](#add)                                 | New shell that routes to every existing remote                                       |
| [`mfeflow add <feature...>`](#add)                                 | Add features, or `@namespace/feature` from a registry                                |
| [`mfeflow add env-key <KEY>`](#add)                                | Add a typed env key, `--scope server` or `runtime`, with `--schema <expr>`           |
| [`mfeflow features [search]`](#features)                           | List and search the features you can add, from mfeflow and every configured registry |
| [`mfeflow registry add\|list\|remove`](#registry)                  | Configure third-party feature registries in `mfeflow.json`                           |
| [`mfeflow registry build <dir>`](#registry-build)                  | Check a folder of features and write the files to host as a registry                 |
| `mfeflow dev`                                                      | Run the shell and every remote; follows `add remote`                                 |
| [`mfeflow deploy <remote>`](#deploy-promote-rollback-and-status)   | Upload a remote's build to a static registry host and point an environment at it     |
| [`mfeflow promote <remote>`](#deploy-promote-rollback-and-status)  | Point one environment at the version another serves; no upload                       |
| [`mfeflow rollback <remote>`](#deploy-promote-rollback-and-status) | Point an environment back at an earlier version; no rebuild                          |
| [`mfeflow status`](#deploy-promote-rollback-and-status)            | What each environment serves, the version before it, and drift                       |
| `mfeflow doctor`, `validate`, `check-compat`, `budget`             | The project and CI checks                                                            |

Exit codes: 0 success, 1 unexpected, 2 bad command line, 3 project or config, 4 feature, 5 build, 6 feature registry, 7 deploy,
130 cancelled. Errors carry a code (`MFEFLOW_E203`) with a [docs page](../errors/E203).

## init

```sh
mfeflow init my-app --scope @acme --remotes catalog,cart,checkout --features lint-oxlint,git-hooks
```

`--scope`, `--remotes a,b`, `--features a,b`, `--option feature.key=value`. Every prompt has a flag; `--yes` takes the
defaults.

## add

```sh
mfeflow add remote checkout --port 4320
mfeflow add git-hooks
mfeflow add @acme/segment --yes
mfeflow add env-key API_ORIGIN --scope server --schema "z.url()"
```

A feature from a registry (`@namespace/name`) is written only after a person confirms the plan, or with `--yes`; without
a terminal, `--yes` is required. See [Third-party features](../features/third-party).

## features

```sh
mfeflow features                 # first-party features, then every configured registry's
mfeflow features analytics       # name, description or keywords contain "analytics"
mfeflow features --json
```

Each line shows the source (`mfeflow`, or the registry's `@namespace`), the name to pass to `add`, the version and the
description. Registries are asked at the same time; one that cannot be read is reported on stderr (and under
`registries[].error` with `--json`) and the others are still listed. The exit code stays 0.

`--json` prints `{ ok, command: "features", search, features: [{ source, name, version, description, always, default,
installed }], registries: [{ namespace, index, items, error }] }`.

## registry

```sh
mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
mfeflow registry add @test http://127.0.0.1:4010/{name}.json
mfeflow registry list
mfeflow registry remove @acme
```

| Action                            | Does                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `registry add @ns <url-template>` | Writes `registries` in `mfeflow.json`. `{name}` is required, `{version}` optional.   |
| `registry list`                   | Prints each namespace with its URL template. `--json` adds the `index.json` URL.     |
| `registry remove @ns`             | Removes it. Refused while a feature installed from that namespace is in the project. |

The URL must be `https`; plain `http` is accepted only for `127.0.0.1`, `localhost` and `[::1]`. `@mfeflow` is reserved.
All three take `--dry-run` and `--json`.

### registry build

```sh
mfeflow registry build ./my-registry --out ./site
```

Reads `<dir>/<feature>/feature.json` for every folder, checks each with the rules `mfeflow add @namespace/name` applies,
and writes `index.json`, `<name>.json`, `<name>/<version>.json` and `<name>/latest.json` to `--out` (default
`<dir>/dist`). All problems are listed at once and nothing is written if there is one (`MFEFLOW_E404`). `--dry-run`
lists the files without writing. See [Publishing a registry](../features/third-party#publishing-a-registry).

## deploy, promote, rollback and status

```sh
mfeflow deploy catalog --env prod --version 1.4.2
mfeflow promote catalog --from staging --to prod
mfeflow rollback catalog --env prod --to 1.3.0
mfeflow status --env prod
```

A walk-through with output is in [Deploy and roll back a remote](./deploying).

| Flag                         | Commands                  | Does                                                                                                      |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--env <env>`                | deploy, rollback, status  | The environment. `status` defaults to every env on the host and every folder in `registry/envs` but `dev` |
| `--from <env>`, `--to <env>` | promote                   | Copy the pointer from one environment to another                                                          |
| `--to <version>`             | rollback                  | Go back to this version, which must be in the history. Default: the previous one                          |
| `--version <v>`              | deploy                    | Default: the remote's `package.json` version                                                              |
| `--dist <dir>`               | deploy                    | Build folder inside the remote. Default `dist`                                                            |
| `--force`                    | rollback                  | Roll back although the schema, route or compat checks fail. The files must still exist                    |
| `--no-publish`               | deploy                    | Upload the files, leave the index where it is. `status` then shows drift                                  |
| `--host <spec>`              | all                       | `file:<dir>` or `s3://<bucket>[/prefix]`. Default `registry.host` in `mfeflow.json`                       |
| `--base-url <url>`           | deploy, promote, rollback | Where the host's files are served from. Default `registry.baseUrl`                                        |
| `--shell-manifest <file>`    | deploy, promote, rollback | The shell's deployed `mf-manifest.json`. Default `envs/<env>/shell/` on the host                          |

S3 settings come from `MFEFLOW_S3_ENDPOINT`, `MFEFLOW_S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
`AWS_SESSION_TOKEN`, and are never printed. `--dry-run` prints the plan as data and writes nothing. Without `--yes`, a
terminal asks before anything moves. A failed gate exits with 7 and one of `MFEFLOW_E501` to `E505`; the other registry
errors are `E506` to `E512`.

`--json` prints `{ ok, command, dryRun, env, fromEnv, host, remote, version, servedBefore, published, previous,
rolledBackFrom, uploads, uploaded, skipped, localEntry, warnings, findings }` for the first three, with `index` added for
a dry run. `status` prints `{ ok, command: "status", host, envs: [{ env, published, generatedAt, remotes }], findings }`.
A successful deploy, promote or rollback also writes `registry/envs/<env>/<remote>.json`, so git records what is served. Not for `dev`: `mfeflow dev` reads that folder.

## Flags on every command

| Flag                   | Does                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `--yes`, `-y`          | Take the defaults, never prompt                                                                     |
| `--preset <file\|url>` | Replay options from a JSON file or https URL (`scope`, `remotes`, `features`, `options`); flags win |
| `--json`               | One JSON document on stdout, nothing else; errors come as `{ ok: false, error }`                    |
| `--dry-run`            | Print the summary and a unified diff, write nothing, run nothing                                    |
| `--cwd <dir>`          | Run as if started in that folder                                                                    |
| `--no-install`         | Do not run the package manager                                                                      |
| `--verbose`            | Show the diff, package manager output and stack traces                                              |
| `--local <path>`       | Link `@mfeflow/*` from a built mfeflow checkout (env `MFEFLOW_LOCAL`)                               |
