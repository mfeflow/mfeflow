# mfeflow

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

Pre-1.0: commands and flags may change in minor versions. To run it from a checkout of the repo, see
[Try it from a checkout](#try-it-from-a-checkout).

```sh
npm create mfeflow@latest my-app -- --yes
cd my-app
pnpm dev                                    # shell on :4300, remotes on :4311, :4312
```

## Commands

| Command                               | Does                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `mfeflow init [dir]`                  | New project: a shell, remotes (default `catalog`, `cart`), pnpm workspace, Turborepo  |
| `mfeflow add remote <name>`           | New remote with its registry entries and a route in every shell                       |
| `mfeflow add shell <name>`            | New shell that routes to every existing remote                                        |
| `mfeflow add <feature...>`            | Add features, or `@namespace/feature` from a registry you added with `registry add`   |
| `mfeflow add env-key <KEY>`           | Add a typed env key: `--scope server` (env.ts) or `runtime`, with `--schema <expr>`   |
| `mfeflow features [search]`           | List and search the features you can add, from mfeflow and every configured registry  |
| `mfeflow registry add @ns <url>`      | Add a third-party feature registry (`https`, or `http` on loopback) to `mfeflow.json` |
| `mfeflow registry list`, `remove @ns` | List the registries, or remove one                                                    |
| `mfeflow registry build <dir>`        | Check a folder of features and write `index.json` and the files to host               |
| `mfeflow dev`                         | Run the shell and every remote, one prefixed log each; follows `add remote`           |
| `mfeflow doctor`                      | Singletons, compatibility, config health, drift; `--fix` repairs the safe ones        |
| `mfeflow validate`                    | `mfeflow.json`, every `mfe.json` and every registry entry against their schemas       |
| `mfeflow check-compat`                | Each remote's shared ranges against the shells it runs in                             |
| `mfeflow budget`                      | Built first-load JS of the shell and each remote against the cost-model budget        |
| `mfeflow deploy <remote> --env <env>` | Upload a remote's build to a static registry host and point the env's index at it     |
| `mfeflow promote <remote>`            | Copy the version one env serves to another env: `--from staging --to prod`            |
| `mfeflow rollback <remote>`           | Point an env back at the previous version, or `--to <version>`, without a rebuild     |
| `mfeflow status`                      | What each env serves, the version before it, and drift from `registry/envs`           |
| `mfeflow --version`, `mfeflow --help` | Version, and help with examples (`mfeflow <command> --help` for one command)          |

Features that ship with it: `core` and `tsconfig` (always), `lint-oxlint`, `url-factory`, `env-t3` and `testing`
(default), `ci-github` and `git-hooks` (opt-in). `init` takes `--scope`, `--remotes a,b`, `--features a,b` and
`--option feature.key=value`; every prompt has a flag.

## dev, doctor and the CI checks

`mfeflow dev` starts every app with `pnpm run dev` in its folder and writes the dev registry the shell reads to
`.mfeflow/dev-registry.json` (apps from `mfeflow.json`, entries from `registry/envs/dev`). When `mfeflow.json` or
`registry/envs/dev` changes it rewrites the file, the shell restarts itself, and a new remote is started. `--only a,b`
runs part of the project; `--remote name=url` uses a server you run yourself (the name must be a remote; the URL must be on
localhost unless `--allow-origin <origin>` names it); Ctrl+C stops every app, process trees included, on Windows too.
It exits 130 after Ctrl+C.

`doctor` runs these checks, each with a code and a docs page (`https://mfeflow.github.io/mfeflow/errors/<code>`). It exits with 0
when there are no errors, else with the lowest exit code among the errors' ranges (project 3 before build 5).

| Check                                 | Code           | Fixed by `--fix`              |
| ------------------------------------- | -------------- | ----------------------------- |
| every app in mfeflow.json is on disk  | E112           |                               |
| valid `mfe.json`, name matches        | E113, E116     |                               |
| no shared port                        | E115           |                               |
| no route claimed twice                | E116           |                               |
| registry entry per remote and env     | E114           | writes the missing ones       |
| linked checkout is built              | E110           |                               |
| one version of each singleton         | E301           |                               |
| every workspace package has a version | E111           | adds `0.0.0`                  |
| remote ranges fit the shell           | E302           |                               |
| copied files match their hash         | E117 (warning) |                               |
| runtime plugins import nothing shared | E303           |                               |
| `.env.example` matches `env.ts`       | E118 (warning) | skipped until `env-t3` exists |
| runtime-config files match the schema | E119           |                               |
| no `PUBLIC_*` variable but constants  | E120 (warning) |                               |
| server keys listed in `turbo.json`    | E121 (warning) |                               |

`validate` runs the schema and registry checks, `check-compat` the compatibility check, `budget` reads the build output
(`dist/`): each remote's entry against `budget.remoteKb` (10), a route against `mfe.json` `budgets.initialJsKb`, and the
shell against `budget.baselineKb + budget.shellKb` (32) when a baseline is set. All four take `--json` and exit non-zero on
errors. LCP is measured by the perf job, not by `budget`.

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
| `--local <path>`       | Link `@mfeflow/*` from a built checkout (env `MFEFLOW_LOCAL`)                                       |

Every write is a plan first: the summary (and with `--dry-run` the diff) is shown, then the files are
written all or nothing, and the install runs inside the same transaction. If the install fails, the
files are put back.

## Errors and exit codes

Errors print the code, one line of fix and a docs link:

```
MFEFLOW_E108 The target folder is not empty: /work/app already has notes.txt
  Fix: Pick a new or empty folder, or move what is in the way.
  https://mfeflow.github.io/mfeflow/errors/E108
```

| Exit | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | success                                                                 |
| 1    | unexpected error (`--verbose` prints the stack)                         |
| 2    | bad command line: `MFEFLOW_E107`, `MFEFLOW_E215`                        |
| 3    | project or config problem: `MFEFLOW_E1xx`                               |
| 4    | feature problem: `MFEFLOW_E2xx`                                         |
| 5    | build or runtime problem: `MFEFLOW_E3xx`                                |
| 6    | registry problem: `MFEFLOW_E4xx`                                        |
| 7    | deploy problem: `MFEFLOW_E5xx`                                          |
| 130  | cancelled at a prompt (nothing was written), or Ctrl+C in `mfeflow dev` |

## Try it from a checkout

Before `@mfeflow/*` is on npm, `--local` writes the dependencies as `link:` to the packages of a clone.
Without it, they are `^<the CLI's version>`.

```sh
git clone https://github.com/mfeflow/mfeflow && cd mfeflow
pnpm install && pnpm build

node packages/cli/bin/mfeflow.js init ../my-app --yes --local .
cd ../my-app
pnpm dev        # http://localhost:4300 renders the shell with both remotes
```

`--local` needs the checkout built (`pnpm build`); it says so (`MFEFLOW_E110`) if a package has no `dist/`.
`MFEFLOW_LOCAL=/path/to/mfeflow` does the same for `init`.
The checkout is recorded in `mfeflow.json` as `"local"` (a path relative to the project), so later `mfeflow add` commands keep writing `link:` without the flag. `--local none` removes it; dependencies already written stay as they are.

MIT licensed.
