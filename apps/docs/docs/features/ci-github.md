# ci-github

A GitHub Actions workflow for pull requests. Opt-in: `mfeflow add ci-github`.

It is not part of the default set because `init` cannot know whether the project will be the root of a GitHub
repository, and a workflow in any other folder never runs. Add it once the repository exists.

## What you get

`.github/workflows/ci.yml` runs on `pull_request` and does, in order:

1. `pnpm install --frozen-lockfile`
2. lint and format check (when `lint-oxlint` is installed), typecheck, tooling typecheck
3. `pnpm test` (when `testing` is installed)
4. `pnpm build`
5. `mfeflow doctor`, `validate`, `check-compat` and `budget`
6. `pnpm check:runtime-config` (when `env-t3` is installed)
7. the Playwright smoke test, with the report uploaded on failure (when `testing` is installed)

A step for a feature the project does not have is skipped, so adding `testing` or `env-t3` later needs no workflow edit.

The workflow starts from `permissions: {}`, the job gets `contents: read` only, checkout does not persist
credentials, and every action is pinned to a commit SHA. `mfeflow` is added as a dev dependency so CI runs the version
your lockfile pins.

`docs/ci.md` in the project describes how to add preview deploys and OIDC credentials. No deploy workflow is
generated yet; deploying to a registry comes with the registry features.
