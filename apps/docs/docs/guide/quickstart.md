# Quickstart

mfeflow is early (0.x) and built in the open. Start a project with one command:

```bash
pnpm create mfeflow my-platform
# or
npm create mfeflow@latest my-platform
```

You get a shell and two remotes (`catalog` and `cart`) in a pnpm monorepo. Pick remotes and features up front, or add features later with `mfeflow add <feature>`:

```bash
pnpm create mfeflow my-platform --scope @acme --remotes catalog,cart,account --features lint-oxlint,env-t3,testing
```

`--dry-run` shows the files it would write without writing anything. pnpm is the only package manager in this release.

See the [features](/features/) for what each one adds, and follow progress on [GitHub](https://github.com/mfeflow/mfeflow).
