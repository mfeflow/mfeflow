# Third-party features

Anyone can publish features for mfeflow. A third-party feature is a `feature.json` hosted on a static site; a user adds
the site as a registry and installs from it:

```sh
mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
mfeflow features                 # lists @acme's features next to the first-party ones
mfeflow add @acme/segment
```

A third-party feature is **declarative**. It lists files, dependencies, script names and edits made by a fixed set of
built-in operations. It never runs code: not at install, not in a hook, not in a migration. `mfeflow add` shows the plan
and the diff before it writes anything, and without a terminal it needs `--yes` to apply a registry feature at all.

## Using a registry

```sh
mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
mfeflow registry list
mfeflow registry remove @acme
```

`registry add` writes `registries` in `mfeflow.json`. It takes `--dry-run` and `--json`.

| Rule                   | Detail                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespace              | `@` and lower-case letters, digits and `-`. `@mfeflow` is reserved for the features that ship with mfeflow.                                                                                        |
| URL template           | Must contain `{name}`, the feature's name without the namespace. `{version}` is optional (`latest` when none was asked for). No other placeholders, none in the host, no user name or password.    |
| `https`                | Always. The one exception is **plain `http` on this machine**: `127.0.0.1`, `localhost` and `[::1]` only, so you can try a registry before it is hosted. Any other `http` URL is refused.          |
| Redirects              | Followed by hand. A redirect may not leave https; a loopback registry may not redirect to another plain-http host; an https registry may not redirect to a loopback address.                       |
| One namespace, one URL | `registry add` refuses to change a namespace that is set. Run `registry remove` first.                                                                                                             |
| In use                 | `registry remove` refuses while a feature installed from that namespace is in the project: `mfeflow add remote` and `add shell` fetch installed registry features again and would fail without it. |

`mfeflow features [search]` reads each registry's `index.json` (at the same time, so one slow registry does not delay the
others) and lists its features with source, name, version and description. The search matches name, description and
keywords. A registry that cannot be read is reported (`MFEFLOW_E401`, or `E403` for a bad index) and the rest are still
listed; the command exits 0. With `--json` the result has `features[].source` and one status per registry under
`registries`.

## Trusting a registry

`mfeflow.json` is committed, so anyone who clones a repo also gets the registries it names. mfeflow does not send a
request to one of them until you have trusted it **on your machine**.

- `mfeflow registry add` trusts what it adds. You typed the address, so that is your yes.
- A registry that only came with a cloned `mfeflow.json` is not asked. `mfeflow features` lists it as "not trusted yet"
  and does not fetch its index. Look at the address (`mfeflow registry list`), then run `mfeflow registry trust @acme`.
  It asks you to confirm; without a terminal it needs `--yes`.
- `mfeflow registry untrust @acme` takes it back.
- In CI, set `MFEFLOW_TRUST_REGISTRIES=@acme,@other` for that run. Nothing is written, and nothing is trusted unless it
  is named.

What you trust is the namespace **and its exact URL template**, kept in `trusted-registries.json` in your own config
folder (`~/.config/mfeflow`, `$XDG_CONFIG_HOME/mfeflow`, or `%APPDATA%\mfeflow` on Windows; `MFEFLOW_CONFIG_DIR`
overrides it). If the URL in `mfeflow.json` changes, the registry is untrusted again.

Two more rules:

- **Your own machine and private networks need trust.** `localhost`, `127.0.0.0/8`, `::1`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` and `fc00::/7` are never requested, nor reached by a redirect,
  unless the registry is trusted (`MFEFLOW_E405`). Only the written host is checked, not what a name resolves to.
- **`mfeflow add @acme/segment` is your explicit action.** For a public https registry it fetches that one
  `feature.json` without prior trust, because you named the feature and nothing is written before you confirm the plan.
  `add remote` and `add shell` fetch every installed registry feature again, so they need the registry trusted.

Each time a registry feature is added, mfeflow records the sha256 of its `feature.json` in `mfeflow.json` as
`integrity`. When `add remote` or `add shell` fetch it again, other bytes stop the command with `MFEFLOW_E406` and
nothing is written; read what changed, then run it again with `--accept-changed-content` to take it. On `add`, a
`version` in the registry's `index.json` that differs from the one in the `feature.json` is an error too.

The plan lists the packages a registry feature adds under **NEW PACKAGES**, separate from other dependencies. npm and
yarn run a package's install scripts on install; pnpm 10 and later blocks them until you allow them. Look at each
package first.

Tokens in a registry URL (`token`, `key`, `sig`, `auth`, `password`, `secret`, `X-Amz-*`) are shown as `***` by
`registry add` and `list`, `features` and in errors. They stay in `mfeflow.json` as written, so keep secrets out of
a file you commit.

## The index

A registry is a folder of static files. `index.json` sits in the folder the URL template starts in, before the first
path segment with a placeholder:

| Template                                 | Index                                  |
| ---------------------------------------- | -------------------------------------- |
| `https://acme.dev/features/{name}.json`  | `https://acme.dev/features/index.json` |
| `https://acme.dev/{version}/{name}.json` | `https://acme.dev/index.json`          |
| `https://acme.dev/api?feature={name}`    | `https://acme.dev/index.json`          |

```json
{
  "$schema": "https://mfeflow.github.io/mfeflow/schema/feature-registry-index.json",
  "items": [
    {
      "name": "segment",
      "version": "1.2.0",
      "description": "Segment analytics behind the analytics provider interface",
      "keywords": ["analytics", "segment"]
    }
  ]
}
```

`name` has no namespace (the registry's namespace goes in front: `@acme/segment`). Descriptions are plain text of at most
300 characters; at most 20 keywords of 40 characters; at most 1000 items; the file at most 1 MB. Control characters are
refused, so an index cannot write escape sequences to your terminal. The schema is at
[`/schema/feature-registry-index.json`](https://mfeflow.github.io/mfeflow/schema/feature-registry-index.json).

## Writing a feature

One folder per feature, each with a `feature.json`:

```
my-registry/
  segment/feature.json
  consent-banner/feature.json
```

```json
{
  "$schema": "https://mfeflow.github.io/mfeflow/schema/feature.json",
  "name": "@acme/segment",
  "version": "1.2.0",
  "description": "Segment analytics behind the analytics provider interface",
  "keywords": ["analytics", "segment"],
  "requires": ["analytics-gtm"],
  "files": [
    {
      "to": "src/analytics/segment.ts",
      "target": "shell",
      "content": "export const SEGMENT = true;\n"
    }
  ],
  "dependencies": [{ "name": "@segment/analytics-next", "range": "^1.80.0", "target": "shell" }],
  "scripts": [
    { "name": "segment:check", "command": "node scripts/segment-check.js", "target": "shell" }
  ],
  "transforms": [
    {
      "op": "add-boot-step",
      "file": "src/bootstrap.tsx",
      "target": "shell",
      "call": "initSegment",
      "from": "./analytics/segment"
    }
  ]
}
```

Fields: `name`, `version`, `description`, `keywords`, `prompts`, `requires`, `conflicts`, `files`, `dependencies`, `scripts`
and `transforms`. Anything else (`migrations`, hooks, unknown keys) is refused with `MFEFLOW_E203`. `target` is `shell`,
`remotes` or one app's name.

### What is allowed

| Part         | Allowed                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name         | `@namespace/name`, never `@mfeflow`. The name in the file must be the name the user asks for.                                                                                                                                                                                                                                                                                                                                        |
| Files        | Inline `content` only (no `from`, no `atRoot`). Only under `src/`, `public/` and `docs/` of the target app. Names are lower-case ASCII (letters, digits, `.`, `_`, `-`). No package-manager or git-hook files, no test, spec or config files (`a.test.ts`, `vite.config.ts`, a `tests/` folder), no `features/` folder, no symlinked path.                                                                                           |
| Dependencies | A registry version, range or dist-tag. Never `file:`, `link:`, `workspace:`, `catalog:`, a git or URL spec, a tarball or an `npm:` alias. An existing dependency's range is never changed silently (`MFEFLOW_E207`).                                                                                                                                                                                                                 |
| Scripts      | Lower-case, starting with the feature's own name: `segment` or `segment:part` for `@acme/segment`, so `build`, `lint:*` and similar runners never pick them up. Never a lifecycle name (`install`, `prepare`, `test`, `start`...), never `pre` or `post` something, never a `pnpm:`, `npm:`, `yarn:` or `bun:` prefix. They are added to `package.json` and shown; mfeflow never runs them. An existing script is never overwritten. |
| Transforms   | `add-import`, `wrap-provider`, `add-shared`, `add-boot-step`, `add-env-key` and `add-route`, on files the path rules above allow. `add-workflow-step` is first-party only: a third-party feature cannot edit CI. Module specifiers must be a package name, a relative path or an `@/` alias, never a URL.                                                                                                                            |
| Env schemas  | `add-env-key` `schema` must be a call chain on `z`, `v` or `type` with literal arguments (`z.string().url()`). It is parsed and written back from the syntax tree, so nothing else can ride along.                                                                                                                                                                                                                                   |
| Size         | The file at most 1 MB.                                                                                                                                                                                                                                                                                                                                                                                                               |

A feature that breaks a rule fails with `MFEFLOW_E203` and a message naming the file or field and the rule. Nothing is
written. A transform operation that does not exist is `MFEFLOW_E204`. If you need an operation that is not in the list,
open an issue: the operations are a public API, not an escape hatch.

## Publishing a registry

`mfeflow registry build` checks every `feature.json` the way `mfeflow add @namespace/name` will, then writes the files to
host:

```sh
mfeflow registry build ./my-registry --out ./site
```

```
Built 1 feature(s) for @acme:
  @acme/segment 1.2.0

Wrote 4 files to /home/you/my-registry/site
```

| File                    | What it is                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| `index.json`            | The index `mfeflow features` reads.                                         |
| `<name>.json`           | The feature, for a template like `https://host/{name}.json`.                |
| `<name>/<version>.json` | The same feature at this version, for `https://host/{name}/{version}.json`. |
| `<name>/latest.json`    | What `{version}` becomes when the user did not ask for one.                 |

`--out` defaults to `<dir>/dist`. `--dry-run` lists what would be written; `--json` prints the result. The build writes
nothing at all when any feature fails, and reports **every** failure in one go, for example:

```
MFEFLOW_E404 A feature in the registry folder cannot be published: 2 problem(s)
  - one/feature.json: A third-party feature uses something third-party features may not: ".npmrc" is outside src/, public/ and docs/, where third-party features may write
  - two/feature.json: A third-party feature uses something third-party features may not: script "install" would run on its own (npm lifecycle)
```

The build also needs: one namespace per registry, one folder per feature name, a semver `version`, a `description`, and no
feature called `index`.

### Hosting on GitHub Pages

1. Put the features in a repository, for example `acme/mfeflow-features`, one folder each.
2. Build into a folder Pages serves, here `docs/`: `mfeflow registry build ./features --out ./docs`.
3. Commit it, and in the repository settings publish Pages from the `main` branch, `/docs` folder.
4. Users run `mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json`.

Any static host works the same way: S3, R2, Netlify, or your own nginx. A GitHub Action that runs
`mfeflow registry build` and deploys the output keeps it fresh on every push.

### Versioning

Versions are semver. The user's `mfeflow.json` records the version that was installed. `<name>.json` and `latest.json` are
the current version; `<name>/<version>.json` stays where it is, so **do not delete old output**: build into the same
folder (or keep it in git) and each release adds one file.

Adding a remote or shell later applies the installed registry features to the new app again, at the recorded version. If
the registry now serves another version and the template has no `{version}`, `mfeflow add` stops with `MFEFLOW_E401`
before writing anything. Registries whose template has `{version}` (`https://host/{name}/{version}.json`) keep working
across releases, which is why the build writes both forms. A published `<name>/<version>.json` should never change;
publish a new version instead.

### Trying it before it is hosted

```sh
mfeflow registry build ./my-registry --out ./site
npx serve ./site -l 4010                       # or any static server
mfeflow registry add @acme http://127.0.0.1:4010/{name}.json
mfeflow add @acme/segment
```

Plain `http` is accepted for `127.0.0.1`, `localhost` and `[::1]` only. `http://192.168.1.5/...` and
`http://localhost.example.com/...` are refused. Switch the registry to its https URL before you commit `mfeflow.json`:
`registry remove`, then `registry add`.
