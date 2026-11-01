# CLI reference

`mfeflow <command> --help` prints the options of one command with examples. Every command takes the
[global flags](#flags-on-every-command).

| Command                                                | Does                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`mfeflow init [dir]`](#init)                          | New project: a shell, remotes (default `catalog`, `cart`), pnpm workspace, Turborepo |
| [`mfeflow add remote <name>`](#add)                    | New remote with its registry entries and a route in every shell                      |
| [`mfeflow add shell <name>`](#add)                     | New shell that routes to every existing remote                                       |
| [`mfeflow add <feature...>`](#add)                     | Add features, or `@namespace/feature` from a registry                                |
| [`mfeflow add env-key <KEY>`](#add)                    | Add a typed env key, `--scope server` or `runtime`, with `--schema <expr>`           |
| [`mfeflow features [search]`](#features)               | List and search the features you can add, from mfeflow and every configured registry |
| [`mfeflow registry add\|list\|remove`](#registry)      | Configure third-party feature registries in `mfeflow.json`                           |
| [`mfeflow registry build <dir>`](#registry-build)      | Check a folder of features and write the files to host as a registry                 |
| `mfeflow dev`                                          | Run the shell and every remote; follows `add remote`                                 |
| `mfeflow doctor`, `validate`, `check-compat`, `budget` | The project and CI checks                                                            |

Exit codes: 0 success, 1 unexpected, 2 bad command line, 3 project or config, 4 feature, 5 build, 6 registry, 7 upgrade,
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
