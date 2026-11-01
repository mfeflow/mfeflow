---
title: feature.json reference
description: Every field of feature.json, the declarative file that defines an mfeflow feature, including files, dependencies, scripts, prompts, conditions and the seven built-in transform operations.
---

# feature.json reference

This page lists every field of `feature.json`. Each mfeflow feature is one of these files plus the files it copies. Third-party features use a limited subset. See [Third-party features](/features/third-party) for those limits.

The JSON Schema is published at `https://mfeflow.github.io/mfeflow/schema/feature.json`. The registry index has its own schema at `feature-registry-index.json` in the same folder.

## Top-level fields

| Field          | Type                  | Required | Meaning                                                       |
| -------------- | --------------------- | -------- | ------------------------------------------------------------- |
| `name`         | text                  | Yes      | `analytics-gtm`, or `@someone/feature` for a registry feature |
| `version`      | text                  | Yes      | The feature version                                           |
| `description`  | text                  | No       | Shown by `mfeflow features`                                   |
| `keywords`     | list                  | No       | Words the registry index lists for search                     |
| `prompts`      | list                  | No       | Questions asked when the feature is added                     |
| `requires`     | list of feature names | No       | Features that must be installed first (E206)                  |
| `conflicts`    | list of feature names | No       | Features that cannot be installed together (E205)             |
| `files`        | list                  | No       | Files to create                                               |
| `dependencies` | list                  | No       | npm packages to add                                           |
| `scripts`      | list                  | No       | `package.json` scripts to add                                 |
| `transforms`   | list                  | No       | Edits to existing files                                       |
| `migrations`   | list                  | No       | First-party only. Not run for third parties                   |

## Targets

Many entries have a `target` that says where they apply.

| Value                        | Applies to       |
| ---------------------------- | ---------------- |
| `root`                       | The project root |
| `shell`                      | Every shell      |
| `remotes`                    | Every remote     |
| an app name, or `app:<name>` | One app          |

## Conditions

An entry with `when` applies only if every condition holds. A plain key is one of the feature's own options and must equal the given value, for example `{ "validator": "zod" }`. A key `feature:<name>` with `true` or `false` asks whether that feature is installed, or is being added in the same command.

## prompts

| Field     | Type                          | Meaning                                                |
| --------- | ----------------------------- | ------------------------------------------------------ |
| `name`    | identifier                    | The option name, used as `--option feature.name=value` |
| `type`    | `boolean`, `string`, `select` | The kind of answer                                     |
| `message` | text                          | The question                                           |
| `default` | text or boolean               | The default answer                                     |
| `choices` | list                          | Required for `select`. The default must be one of them |

## files

| Field      | Type          | Meaning                                                                                         |
| ---------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `to`       | relative path | Destination, relative to the target. Template values such as the app name are filled in per app |
| `target`   | target        | Where to write                                                                                  |
| `when`     | condition     | Write only if it holds                                                                          |
| `from`     | relative path | Source file in the feature folder. Not allowed for third parties                                |
| `content`  | text          | Inline content. The only source a third party may use                                           |
| `template` | boolean       | Render with templating                                                                          |
| `atRoot`   | boolean       | Resolve `to` from the project root. First-party only                                            |

Each file needs exactly one of `from` or `content`. Paths use forward slashes and no `..`.

## dependencies

| Field            | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `name`           | npm package name, or `{{scope}}/<name>` for a package of the project |
| `range`          | Version range                                                        |
| `dev`            | Add to `devDependencies`                                             |
| `target`, `when` | As above                                                             |

## scripts

Each has a `name`, a `command`, and optional `target` and `when`. Names use letters, digits and `: _ . -`. The script is added to the `package.json` files. It is not run. A third-party script name must start with the feature's own name.

## transforms

Each transform has an `op`, a `file` to edit and optional `target` and `when`. The built-in operations are a public, versioned API.

| `op`                | Does                                          | Main fields                                                                         |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `add-import`        | Adds an import                                | `from`, `named`, `default`, `namespace`, `typeOnly`                                 |
| `wrap-provider`     | Wraps the output of a component in a provider | `component`, `from`, `props`, `defaultImport`, `function`                           |
| `add-shared`        | Adds a package to the singleton list          | `name`, `list`                                                                      |
| `add-boot-step`     | Adds a call to the start-up sequence          | `call`, `from`, `args`, `await`, `before`, `after`, `function`                      |
| `add-env-key`       | Adds a typed env key                          | `key`, `scope` (`server` or `runtime`), `schema`, `value`, `example`, `configFiles` |
| `add-route`         | Adds a route to a route array                 | `path`, `component`, `from`, `routes`                                               |
| `add-workflow-step` | Adds a step to a CI workflow job              | `job`, `step`, `after`                                                              |

For `add-env-key`, `schema` is source text, or an object with one text per validator (`zod`, `valibot`, `arktype`). The one matching the file's validator is used. An unknown operation is E204. A file that is missing or shaped differently than expected is E208.

## migrations

First-party only. Each has `from`, `to` and a `module` path. They are declared so a future upgrade command can read them. They never run for third-party features.

## Example

A small feature that adds one file and one dependency:

```json title="feature.json"
{
  "name": "@acme/hello",
  "version": "1.0.0",
  "description": "Adds a hello module to every remote.",
  "keywords": ["example"],
  "files": [
    { "to": "src/hello.ts", "target": "remotes", "content": "export const hello = 'hi';\n" }
  ],
  "dependencies": [{ "name": "nanoid", "range": "^5.0.0", "target": "remotes" }]
}
```

## Errors

An invalid file is E202. A third-party feature that uses something it may not is E203. See [Error codes](/reference/errors).
