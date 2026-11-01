---
title: commit-prompt - guided Conventional Commit messages
description: Answer a few prompts and get a correctly formatted Conventional Commit message, so nobody has to remember the format.
---

# commit-prompt

This page shows how to write commit messages in the Conventional Commits format by answering questions instead of remembering the rules. It suits teams where not everyone has the format memorised.

## What you get

A `pnpm commit` command that asks for the type, scope and description, then runs the commit for you. It is off by default.

## Add it

```sh
pnpm mfeflow add commit-prompt
```

What changed:

```text
cz.config.js   # prompt settings, at the project root
package.json   # gains a commit script that runs czg
               # and czg 1.14.0 as a dev dependency
```

## Use it

Stage your changes, then run the prompt instead of `git commit`:

```sh
git add -p
pnpm commit
```

It asks for the type, the scope, a short description, a longer one, and any breaking change or issue it closes. Then it commits with a message like this:

```text
feat(cart): add the coupon field
```

## Configure it

Everything is in `cz.config.js`, and the only edit most projects need is the scope list:

```js title="cz.config.js"
export default {
  useEmoji: false,
  upperCaseSubject: false,
  allowCustomScopes: true,
  allowEmptyScopes: true,
  allowBreakingChanges: ['feat', 'fix'],
  maxHeaderLength: 100,
  scopes: ['deps', 'ci'],
  skipQuestions: ['footerPrefix'],
  // types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
};
```

| Setting                | Default       | What it does                                       |
| ---------------------- | ------------- | -------------------------------------------------- |
| `scopes`               | `deps`, `ci`  | The list offered; add your remotes and areas       |
| `allowCustomScopes`    | `true`        | Lets you type a scope that is not in the list      |
| `maxHeaderLength`      | 100           | Longest first line the prompt accepts              |
| `upperCaseSubject`     | `false`       | Keeps the subject lowercase, as commitlint expects |
| `allowBreakingChanges` | `feat`, `fix` | Types that offer a breaking-change question        |

## How it works

The prompt tool reads `cz.config.js`, builds the message from your answers and passes it to `git commit`. The types are the eleven that commitlint's conventional config accepts.

The header limit and lowercase subject match its rules. A message from the prompt passes the check in [git-hooks](/features/git-hooks) when that is installed.

The prompt does not install a hook of its own. Plain `git commit` still opens your editor as before, and a hand-written message goes through the same commitlint check.

## Gotchas

- The prompt needs a terminal. In CI or a script, use `git commit -m "feat(cart): ..."` directly.
- Emoji is switched off. Set `useEmoji` to `true` if your team wants it, but check that your commitlint rules allow it.

## Reference

- [git-hooks](/features/git-hooks)
- [czg](https://github.com/Zhengqbbb/cz-git)
- [Conventional Commits](https://www.conventionalcommits.org)
