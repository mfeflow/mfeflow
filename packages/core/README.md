# @mfeflow/core

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

The engine behind the `mfeflow` CLI: loads and saves `mfeflow.json`, plans a change as data with a unified diff, applies it atomically with rollback, and resolves features. Pre-1.0: minor versions may change the API. Most people want the [`mfeflow`](https://www.npmjs.com/package/mfeflow) CLI instead.

```sh
pnpm add @mfeflow/core
```

Docs: [mfeflow.github.io/mfeflow](https://mfeflow.github.io/mfeflow/).

MIT licensed.

## What a third-party feature may do

A feature from a namespaced registry (`@someone/name`) is untrusted. It is
declarative only and is checked against allowlists when it is loaded and again
when it is resolved into a plan. It can never cause code to run on apply,
install, commit or the next `mfeflow` command.

- **Files and transforms** write only under `src/`, `public/` or `docs/` of the
  target, with plain lower-case ASCII names. Root files, dot folders, package
  manager config (`package.json`, lockfiles, `.npmrc`, `.yarnrc*`,
  `.pnpmfile.*`, `pnpm-workspace.yaml`), git hook managers, test and tool config
  files and the local `features/` folder are refused. Paths are compared after
  Unicode (NFC) and case folding, and names with trailing dots or spaces, `:`,
  invisible characters or Windows device names are refused for every feature.
- **Scripts** are lower-case words joined by `:` and start with the feature's
  own name (`segment:check` for `@acme/segment`), so `build`, `lint:*` and
  other runners never pick them up. Lifecycle events, `pnpm:`, `npm:`, `yarn:`
  and `bun:` prefixes and every `pre` or `post` name are refused.
- **Dependencies** take a semver range or a dist-tag. `file:`, `link:`, git,
  URLs, `npm:` aliases, `workspace:` and `catalog:` are refused.
- **Imports** name a package, a relative path or an `@/` alias, never a URL.
- **`add-env-key`** schema text must be a call chain on `z`, `v` or `type` with
  literal arguments; the plan writes it re-emitted from the parsed tree. Because
  `.env.example` and root `env.ts` are outside the allowlist, third parties can
  add runtime-config keys (under `src/` and `public/`) but not dotenv examples.
- **`add-workflow-step`** is refused: third-party features cannot edit CI.

For every feature, first-party included: a script or dependency that already
exists with another value is an E207 conflict in the plan, never an overwrite;
a first-party CI change shows as a warning in the plan summary; and `applyPlan`
checks that every target resolves, symlinks included, to inside the project
before writing anything. Its rollback restores files by temp file and rename,
and after a failed install it also puts back `package.json`, the workspace file
and the lockfiles the install touched (`node_modules` is not rolled back).
