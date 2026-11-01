# Registry fixture

A third-party feature registry in its source form: one folder per feature, each with a `feature.json`.
`@test/hello` adds `src/hello.ts` to the shell and the `clsx` package it imports.

The tests build it and serve the result from `127.0.0.1`, then install the feature the way a user would:

```sh
mfeflow registry build e2e/registry-fixture --out /tmp/registry
# serve /tmp/registry on any port, then, in a project:
mfeflow registry add @test http://127.0.0.1:<port>/{name}.json
mfeflow add @test/hello --yes
```

- `packages/cli/src/registry-flow.test.ts` runs that against the CLI in-process.
- `e2e/matrix/registry.ts` runs it on a generated project that is installed, built, linted and checked (CI: the `registry` job in `matrix.yml`).
