# testing

Unit tests in every app and a browser smoke test for the whole platform. On by default in new projects.

```sh
pnpm mfeflow add testing
pnpm test                       # Vitest, every app
pnpm exec playwright install chromium   # once
pnpm test:e2e                   # Playwright, headless
```

## What you get

- **Every app**: `vitest.config.ts` (jsdom), `src/test/setup.ts` (cleans up between tests and resets platform state with
  `resetPlatform()` from `@mfeflow/testing`), and a `src/mocks/` folder with an MSW server and default handlers.
  Requests nothing answers fail the test.
- **A sample test per app**: the shell renders `Home` and each remote renders its exposed `App` through
  `renderWithPlatform`, which wraps components in the same providers the shell composes.
- **Project root**: `vitest.config.ts` running every app's tests (`pnpm test`), and `playwright.config.ts` with
  `e2e/smoke.spec.ts`.

## The smoke test

`e2e/smoke.spec.ts` opens the shell and checks that it loads without page errors and that every remote listed in
`registry/envs/dev` renders (each remote's `App` carries `data-testid="<name>"`). Playwright starts `pnpm dev` and
stops it afterwards. Set `BASE_URL` to run the same test against a deployed shell, such as a preview:

```sh
BASE_URL=https://staging.example.com pnpm test:e2e
```

Reports and traces go to `node_modules/.cache/playwright`, not into your working tree.

## Notes

- A server variable that `env.ts` requires must be set for `pnpm dev`, so set it before `pnpm test:e2e`.
- The vitest config lists `react`, `react-dom` and Testing Library under `resolve.dedupe`, so a linked package never
  brings a second copy of React into a test.
