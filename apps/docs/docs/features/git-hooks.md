---
title: git-hooks - check commits and pushes automatically
description: Reject badly formatted commit messages and type errors before they leave your machine, using lefthook and commitlint.
---

# git-hooks

This page shows how to catch two common mistakes before they reach the remote: a commit message that breaks the Conventional Commits format, and a push that does not typecheck. The checks run on your machine, so you find out in seconds rather than after CI.

## What you get

Two Git hooks managed by lefthook: commitlint on every commit message, and a typecheck before every push. This feature is off by default.

## Add it

```sh
pnpm mfeflow add git-hooks
```

What changed at the project root:

```text
./
├── lefthook.yml          # which commands run on which hook
├── commitlint.config.js  # the commit message rules
└── package.json          # a prepare script that installs the hooks
```

The prepare script runs `lefthook install`, so hooks are set up after every `pnpm install`. Root dev dependencies added:

```text
lefthook                         2.2.2
@commitlint/cli                  21.2.4
@commitlint/config-conventional  21.2.4
```

## Use it

Run `pnpm install` once so the `prepare` script installs the hooks. After that you work as usual. A message that does not follow the format is rejected at commit time:

```text
git commit -m "fixed stuff"
```

The commit is refused with commitlint's list of problems. This one passes:

```text
git commit -m "fix(cart): keep the coupon after a refresh"
```

Before `git push`, the hook runs `pnpm typecheck` and stops the push if it fails.

## Configure it

The feature has no install options. Both files are small and yours to edit:

```yaml title="lefthook.yml"
commit-msg:
  commands:
    commitlint:
      run: pnpm commitlint --edit {1}

pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
```

```js title="commitlint.config.js"
export default { extends: ['@commitlint/config-conventional'] };
```

| To do this                      | Change                                   |
| ------------------------------- | ---------------------------------------- |
| Add a check before commit       | A `pre-commit` section in `lefthook.yml` |
| Run lint or tests before a push | Another command under `pre-push`         |
| Loosen or tighten message rules | The `rules` in `commitlint.config.js`    |

## How it works

lefthook writes small scripts into your repository's hooks folder. Those scripts call back into lefthook, which reads `lefthook.yml`.

The `prepare` script re-runs the install, so a fresh clone gets the hooks after `pnpm install`. commitlint receives the path to the message file as `{1}` and checks it against the conventional config.

## Gotchas

- A commit can skip hooks with the `--no-verify` flag. Treat hooks as a convenience and keep [CI](/features/ci-github) as the check that cannot be skipped.

- lefthook is allowed to run its install script in the generated `pnpm-workspace.yaml`. If you edit that file, keep the entry or `prepare` has nothing to run.

- Typecheck on push can take a while in a large project. Move it out of `lefthook.yml` if it slows you down and rely on CI.

## Reference

- [commit-prompt](/features/commit-prompt), which builds messages that pass this check
- [ci-github](/features/ci-github)
- [lefthook](https://lefthook.dev)
- [commitlint](https://commitlint.js.org)
