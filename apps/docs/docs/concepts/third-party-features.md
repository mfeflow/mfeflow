---
title: Third-party features
description: How anyone can publish mfeflow features as static JSON, why they are data and not code, and what the rules and safeguards are. A short overview with links to the full guide.
---

# Third-party features

This page explains how features written by other people work and why they are safe to install. It is an overview. The full guide to installing and publishing is [Third-party features](/features/third-party).

## What is a third-party feature?

mfeflow's own features, like analytics or theming, are files and edits described in a `feature.json`. Anyone can write one of those and publish it from a static website. People add the site as a registry, then install by name.

The name has a namespace, for example `@acme/segment`. The names without a namespace belong to mfeflow.

## Why is it safe?

A third-party feature is data. It cannot run code on your machine, and it has no install scripts of its own.

- It can create files, and files it creates carry their text inline.
- It can add dependencies and script names, and script names must start with the feature's own name.
- It can use only the built-in edits, such as adding an import or wrapping a provider.
- It cannot use migrations, or copy files from outside its own definition.

The CLI shows the whole plan and the diff, and asks for a yes before it writes. Without a terminal you must pass `--yes`. Everything is applied all or nothing, so a failed install rolls the files back.

Dependencies it adds still come from npm, so read the plan. The feature is data, but the packages it names are code.

## How do I use one?

Add the registry once, then add the feature:

```bash
pnpm mfeflow registry add @acme https://acme.github.io/mfeflow-features/{name}.json
pnpm mfeflow add @acme/segment
```

The URL template must use https, and `{name}` must be in it. The namespace `@mfeflow` is reserved.

Plain http is accepted only for loopback hosts, which helps when testing a registry. Those are localhost, 127.0.0.1 and [::1].

You can search registries along with built-in features:

```bash
pnpm mfeflow features segment
```

## How do I publish one?

Write a folder per feature, each with a `feature.json`. Then build the registry:

```bash
pnpm mfeflow registry build ./my-registry --out ./site
```

The command checks every feature with the rules that install applies, lists all problems at once and writes nothing when there is one. On success it writes an `index.json` and the feature files, ready for any static host.

## What are the limits?

The set of edits is fixed. A feature that needs a new kind of edit cannot be a third-party feature. The edits are a public API that changes with versions, so check the [feature.json reference](/reference/feature-json) for your mfeflow version.

Registries are trusted by the person who adds them. mfeflow does not review what a registry publishes.

## Related

- The field list: [feature.json reference](/reference/feature-json).
- The commands: [CLI reference](/reference/cli#registry).
