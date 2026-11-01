# commit-prompt

An interactive Conventional Commits prompt. Off by default.

```sh
pnpm mfeflow add commit-prompt
git add -p
pnpm commit
```

`pnpm commit` runs [`czg`](https://github.com/Zhengqbbb/cz-git), which asks for the type, the scope, a short
description, a longer one and any breaking change or issue it closes, then runs `git commit` with the message it
built: `feat(cart): add the coupon field`.

## What you get

| File            | What it is for                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `cz.config.js`  | The prompt's settings: the eleven Conventional Commits types, no emoji, a scope list you extend. |
| `commit` script | `czg`, in the root `package.json`.                                                               |

`czg` is the only dependency (a dev dependency of the root package). Its optional AI subject generator needs an API
key you set yourself and is off unless you ask for it with `pnpm commit ai`.

## With git-hooks

`git-hooks` is not required. When it is installed, its `commit-msg` hook runs commitlint on the
message `pnpm commit` produced. The types in `cz.config.js` are the ones `@commitlint/config-conventional` accepts and
the header limit is its 100 characters, so a message from the prompt passes. A message written by hand still goes through
the same check.

The prompt does not install a `prepare-commit-msg` hook, so plain `git commit` keeps working as it did, with
your editor.

## Scopes

`scopes` in `cz.config.js` is a list shown to pick from; the prompt also lets you type another or leave it empty.
Put your remotes and areas in it (`'cart'`, `'shell'`, `'deps'`).

## Not interactive

The prompt needs a terminal. In CI, or from a script, use `git commit -m "feat(cart): ..."`.
