---
title: Add features
description: How to add, preview and configure mfeflow features with the add command, including the dry-run diff, feature options, presets, atomic rollback and third-party registries.
---

# Add features

This guide shows how to add a feature to a project, how to preview the change, and how to set a feature's options. Features are optional pieces such as analytics, theming or tests. For the list, see the [feature catalog](/features/).

## See what is available

List every feature you can add:

```bash
pnpm mfeflow features
```

You should see one line per feature with its source, name, version and a description. Each line ends with a tag such as `[opt-in]` or `[installed]`:

```text
  mfeflow env-t3            0.1.0   Typed env with t3-env: ... [default, installed]
  mfeflow analytics-gtm     0.1.0   Google Tag Manager with Consent Mode v2 ... [opt-in]
```

Search by word with `pnpm mfeflow features analytics`.

## Preview before you write

Every change can be previewed. Add `--dry-run` to see the plan and the diff:

```bash
pnpm mfeflow add analytics-gtm --dry-run
```

You should see the number of files to create and patch, the file list, the dependencies and scripts it would add, and a unified diff of each file. The last line is:

```text
Dry run: nothing was written.
```

Nothing is installed or changed. Read the diff the way you would read a pull request.

## Add the feature

Run the command without `--dry-run`:

```bash
pnpm mfeflow add analytics-gtm
```

The CLI builds the whole plan first. It then writes every file, edits the others, updates `mfeflow.json` and installs dependencies. If any step fails, including the install, it puts the original files back. You never end up with half a feature.

You can add several at once, such as `pnpm mfeflow add tailwind ui-shadcn`. A feature that needs another one stops with a clear message if the other is missing (E206).

## Set a feature's options

Some features ask a question, such as which validator env-t3 should use. Answer it from the command line with `--option`:

```bash
pnpm mfeflow add env-t3 --option env-t3.validator=valibot
```

The form is `feature.key=value`, and you can repeat the flag. In a terminal, unanswered questions are asked. With `--yes`, defaults are used.

## Replay choices from a file

A preset is a JSON file or an https URL that holds choices. It is useful for teams that want the same setup every time. This file picks features and a validator:

```json title="preset.json"
{
  "features": ["lint-oxlint", "env-t3", "testing"],
  "options": { "env-t3": { "validator": "valibot" } }
}
```

Pass it with `--preset preset.json` to `init` or `add`. Flags win over the preset. A key the preset does not know is an error (E109), so typos do not pass silently.

## Add a feature someone else wrote

Features can also come from a registry that anyone hosts. First tell the project where the registry is:

```bash
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
```

You should see the namespace added to `mfeflow.json`. Then add a feature by its full name:

```bash
pnpm mfeflow add @acme/segment
```

The CLI shows the plan and asks for a yes before it writes anything. Without a terminal you must pass `--yes`. These features are plain data, so they cannot run code. [Third-party features](/concepts/third-party-features) explains the limits, and the [full guide](/features/third-party) covers publishing.

## What happens to a feature after you add it?

The files are yours. mfeflow records the feature and a hash of each file it wrote in `mfeflow.json`. There is no `remove` command. To drop a feature, delete its files and dependencies by hand, then clean up `mfeflow.json`. `mfeflow upgrade` moves a project to a new version. See [Versions and upgrades](/guide/upgrading).

## Next steps

- Browse features: [Feature catalog](/features/).
- Every flag of `add`: [CLI reference](/reference/cli#add).
- What a feature file contains: [feature.json reference](/reference/feature-json).
