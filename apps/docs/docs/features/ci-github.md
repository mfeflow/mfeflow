---
title: ci-github - a pull request check for the whole platform
description: Add a GitHub Actions workflow that lints, type-checks, tests, builds and runs the mfeflow checks on every pull request.
---

# ci-github

This page shows how to get a pull request check that fails when a change breaks the platform, not just the app it touched. You add one workflow file, and it keeps working as you add features.

## What you get

One workflow, `ci.yml`, with a single `check` job, plus a short `docs/ci.md` about preview deploys and cloud credentials. It is off by default, because `init` cannot know whether your project is the root of a GitHub repository, and a workflow anywhere else never runs.

## Add it

Add it once the repository exists:

```sh
pnpm mfeflow add ci-github
```

What changed:

- `.github/workflows/ci.yml`
- `docs/ci.md`
- `mfeflow` added as a root dev dependency, so CI runs the version your lockfile pins

## Use it

Open a pull request and the `check` job runs. In your repository settings, under Rules, make `check` a required status check on your default branch, so a red run blocks the merge.

The job runs these steps in order:

```text
pnpm install --frozen-lockfile
pnpm lint                      (when .oxlintrc.json exists)
pnpm format:check              (when .prettierrc.json exists)
pnpm typecheck
pnpm run --if-present typecheck:tooling
pnpm run --if-present test
pnpm build
pnpm mfeflow doctor
pnpm mfeflow validate
pnpm mfeflow check-compat
pnpm mfeflow budget
pnpm run --if-present check:runtime-config
playwright install, then pnpm run test:e2e   (when playwright.config.ts exists)
```

If the smoke test fails, the Playwright report is uploaded as an artifact and kept for 7 days. What each mfeflow check looks for, and how budgets work, is in [CI and budgets](/guide/ci-and-budgets).

## Configure it

There are no install options. The workflow adapts to what is in the repository:

| Step           | Runs when                                         |
| -------------- | ------------------------------------------------- |
| Lint           | `.oxlintrc.json` exists (`lint-oxlint`)           |
| Format check   | `.prettierrc.json` exists                         |
| Tests          | a `test` script exists (`testing`)                |
| Runtime config | a `check:runtime-config` script exists (`env-t3`) |
| Playwright     | `playwright.config.ts` exists (`testing`)         |

Because skipped steps are decided by file and script checks, adding `testing` or `env-t3` later needs no edit to the workflow.

## How it works

The workflow starts from `permissions: {}` and gives the job `contents: read` only. Checkout does not keep credentials, a second push to the same ref cancels the older run, and the job times out after 20 minutes. Node comes from the latest LTS and pnpm from your `packageManager` field.

Every action is pinned to a commit SHA with the version in a comment, which means an updated action reaches you through a change you review. Dependabot or Renovate can bump those pins for you.

## Gotchas

- The workflow runs on `pull_request` only. It does not run on pushes to your default branch.
- This release generates no deploy workflow. `docs/ci.md` describes the shape to follow when you add one: read-only permissions, `id-token: write` for short-lived cloud credentials instead of stored keys, and each preview uploaded to its own path. See [Deploying](/guide/deploying).

## Reference

- [CI and budgets](/guide/ci-and-budgets)
- [testing](/features/testing)
- [env-t3](/features/env-t3)
- [mfeflow CLI](/reference/cli)
