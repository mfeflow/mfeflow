# CI

`.github/workflows/ci.yml` runs on every pull request: lint, formatting, typecheck, tests, build, then
`pnpm mfeflow doctor`, `validate`, `check-compat` and `budget`, the runtime-config check and the Playwright smoke test.
A step for a feature the project does not have is skipped, so adding `testing` or `env-t3` later needs no edit to the
workflow. Every action is pinned to a commit SHA, the workflow starts from `permissions: {}`, and the job gets
`contents: read` only. Dependabot or Renovate can keep the pins current.

Make the `check` job a required status check on your default branch (Settings, Rules, Rulesets).

## Preview deploys (not generated yet)

mfeflow does not generate a deploy workflow in this release: pushing remotes to a registry comes with the registry
features. When you add a deploy job, keep to this shape.

- Run it on `pull_request` with `contents: read` and `id-token: write`, and no repository secrets.
- Upload the build of one remote to its own path, for example `preview/<remote>/<pr-number>/`, never to the
  path production reads.
- Comment the override link on the pull request. `?mfe-override=<remote>@<url of its mf-manifest.json>` on the
  staging shell loads that build instead of the registered one (the shell honours it outside production only).
- Pull requests from forks get no `id-token`, so they cannot deploy; build them without a preview.

## OIDC instead of stored cloud keys

Let the job ask GitHub for a short-lived token and exchange it for cloud credentials; no access key sits in the
repository settings.

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@<sha>
    with:
      role-to-assume: arn:aws:iam::<account>:role/<team>-deploy
      aws-region: eu-west-1
```

Give each team a role that can write only its own prefixes (`mfe/<remote>/*` and `preview/<remote>/*`), and restrict the
role's trust policy to this repository, the `pull_request` or `main` ref, and the workflow file. The same pattern
works with Google Cloud (`google-github-actions/auth`) and Azure (`azure/login`).
