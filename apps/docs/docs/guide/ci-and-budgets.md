---
title: CI and budgets
description: Run mfeflow's validate, check-compat, doctor and budget checks in CI, add the GitHub pull request workflow, and set the shell and remote JavaScript budgets.
---

# CI and budgets

This guide shows how to run the project checks on every pull request and how to set the size budgets they enforce. Every check exits non-zero on an error, so any CI system can use them.

## Which checks exist?

Four commands check a project. They read your files. Only `budget` needs a build first.

| Command        | Checks                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `validate`     | `mfeflow.json`, every `mfeflow.app.json` and every registry entry against their schemas, plus route overlaps |
| `check-compat` | Each remote's shared package ranges against the shell it runs in                                             |
| `doctor`       | Everything above, plus ports, singleton versions, copied-file drift and env files                            |
| `budget`       | The built JavaScript of the shell and each remote against the budget                                         |

Run them in this order in CI: validate, check-compat, doctor, then build, then budget. Each prints one line per check, then a summary.

If your shell lives in another repository, `check-compat` has nothing local to compare with and warns. Point it at the deployed shell instead, as in the [reference](/reference/cli#check-compat):

```bash
pnpm mfeflow check-compat --against https://cdn.example.com/envs/prod/index.json
```

You should see one `compat` line that passes, or a skewed React named as an error.

## Add the GitHub workflow

If your repository is on GitHub, one feature adds a pull request workflow. Add it:

```bash
pnpm mfeflow add ci-github
```

You should see two new files, `.github/workflows/ci.yml` and `docs/ci.md`. The workflow runs on `pull_request`. Its steps run in this order:

```text
install, lint, format check, typecheck, test, build,
doctor, validate, check-compat, budget,
runtime-config check, Playwright smoke test
```

Steps for features you have not added are skipped by a file check, so the same workflow works as the project grows. Details are on the [ci-github page](/features/ci-github).

## Use another CI system

Run the same commands. A minimal sequence in any shell:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm mfeflow doctor
pnpm mfeflow validate
pnpm mfeflow check-compat
pnpm mfeflow budget
```

A failing check exits with a code by area: 3 for project or config, 4 for features, 5 for build or runtime. When several areas fail, the lowest code wins. Add `--json` to read the result in a script:

```bash
pnpm --silent mfeflow doctor --json
```

You should see one JSON document with the result, a summary, the checks and the findings. The shape is in the [CLI reference](/reference/cli#output-and-exit-codes).

## What does the budget measure?

The budget is a cost model. It states how much a federated page may cost compared with the same pages built as one app. There are three numbers:

| Limit                                          | Default | Measured by                                 |
| ---------------------------------------------- | ------- | ------------------------------------------- |
| JavaScript the shell adds over a one-app build | 32 KB   | `mfeflow budget`, needs `budget.baselineKb` |
| JavaScript each remote adds on a route         | 10 KB   | `mfeflow budget`                            |
| Largest contentful paint the shell adds        | 300 ms  | A perf job you run, not `mfeflow budget`    |

Sizes are gzip, with 1 KB equal to 1024 bytes. The command prints what it could check and says plainly what it could not:

```text
Initial JS, gzip (1 KB = 1024 bytes):
  shell shell: 99.8 KB in 2 scripts, no baseline set (budget.baselineKb), not checked
  remote catalog: entry 7.1 KB, limit 10
LCP (+300 ms) is measured by the perf job, not here.
```

Read [The cost model](/concepts/cost-model) for why these numbers and for a passing measurement of the storefront example.

## Turn on the shell check

The shell is only checked when you tell the tool what your pages weigh as one app. Build your pages as a single app, note the initial gzip JavaScript, and put it in `mfeflow.json`:

```json title="mfeflow.json"
{
  "budget": { "baselineKb": 85, "remoteKb": 12 }
}
```

The example above sets the baseline to 85 KB and raises the remote limit to 12 KB. The shell then has to stay under baseline plus 32 KB. Both numbers are examples. Measure your own.

## Per-remote limits

A remote can set a stricter number in its own `mfeflow.app.json` under `budgets.initialJsKb`. The budget command checks each route's exposed module against it. See the [mfeflow.app.json reference](/reference/mfeflow-app-json).

## If the budget fails

A failing budget prints E304 with the sizes. A missing build prints E305, so run `pnpm build` first. Both have [error pages](/reference/errors) with fixes.
