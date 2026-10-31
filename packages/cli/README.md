# mfeflow

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

**Early, built in the open.** `init`, `add` and `features` work; nothing is published to npm yet, so
until it is, run it from a checkout (see [Try it from a checkout](#try-it-from-a-checkout)).

```sh
npm create mfeflow@latest my-app -- --yes   # once published
cd my-app
pnpm dev                                    # shell on :4300, remotes on :4311, :4312
```

## Commands

| Command                               | Does                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `mfeflow init [dir]`                  | New project: a shell, remotes (default `catalog`, `cart`), pnpm workspace, Turborepo |
| `mfeflow add remote <name>`           | New remote with its registry entries and a route in every shell                      |
| `mfeflow add shell <name>`            | New shell that routes to every existing remote                                       |
| `mfeflow add <feature...>`            | Add features, or `@namespace/feature` from a registry in `mfeflow.json`              |
| `mfeflow features [search]`           | List the features you can add                                                        |
| `mfeflow --version`, `mfeflow --help` | Version, and help with examples (`mfeflow <command> --help` for one command)         |

Features that ship with it: `core` and `tsconfig` (always), `lint-oxlint` and `url-factory` (default),
`git-hooks` (opt-in). `init` takes `--scope`, `--remotes a,b`, `--features a,b` and
`--option feature.key=value`; every prompt has a flag.

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
  https://mfeflow.dev/errors/E108
```

| Exit | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | success                                          |
| 1    | unexpected error (`--verbose` prints the stack)  |
| 2    | bad command line: `MFEFLOW_E107`, `MFEFLOW_E215` |
| 3    | project or config problem: `MFEFLOW_E1xx`        |
| 4    | feature problem: `MFEFLOW_E2xx`                  |
| 5    | build or runtime problem: `MFEFLOW_E3xx`         |
| 6    | registry problem: `MFEFLOW_E4xx`                 |
| 7    | upgrade problem: `MFEFLOW_E5xx`                  |
| 130  | cancelled at a prompt; nothing was written       |

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
