---
title: testing - unit tests and a browser smoke test
description: Run Vitest unit tests in every app and a Playwright smoke test that opens the shell and checks that each remote renders.
---

# testing

This page covers how to test one app in isolation and then the whole platform in a browser. Unit tests are fast and live next to the code; one end-to-end test checks that the shell and every remote actually load together.

## What you get

Every app gets Vitest with jsdom, Testing Library, and an MSW mock server, plus a sample test. The project root gets one command that runs all of them and a Playwright smoke test. This feature is on by default in new projects.

## Add it

```sh
pnpm mfeflow add testing
```

What changed in the project:

```text
vitest.config.ts          # root, runs every app's config as a project
playwright.config.ts      # root, the smoke test setup
e2e/
└── smoke.spec.ts         # the browser smoke test
apps/<app>/
├── vitest.config.ts      # per-app Vitest config
└── src/
    ├── test/
    │   └── setup.ts      # starts the mock server
    └── mocks/
        ├── handlers.ts   # your mocked endpoints
        ├── server.ts     # the MSW server
        └── handlers.test.ts
```

Each app also gets a sample test. The shell has one in its Home page, and each remote has one next to its App:

```text
apps/shell/src/pages/Home.test.tsx
apps/<remote>/src/exposed/App.test.tsx
```

The root package.json gets three scripts:

```text
test
test:e2e
typecheck:tooling
```

## Use it

```sh
pnpm test                               # Vitest in every app
pnpm exec playwright install chromium   # once per machine
pnpm test:e2e                           # Playwright, headless
```

A component test renders through `renderWithPlatform`, which wraps it in the same providers the shell composes:

```tsx title="apps/cart/src/exposed/App.test.tsx"
import { fireEvent, screen } from '@testing-library/react';
import { renderWithPlatform } from '@mfeflow/testing';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('the exposed App', () => {
  it('counts clicks', () => {
    renderWithPlatform(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Clicked 0 times' }));
    expect(screen.getByRole('button', { name: 'Clicked 1 times' })).toBeDefined();
  });
});
```

Network calls are answered by handlers in `src/mocks/handlers.ts`. Add the endpoints your app calls, and override one for a single test:

```ts
server.use(http.get('*/api/health', () => HttpResponse.json({ ok: false })));
```

The smoke test opens the shell, fails on any page error, console error, failed request or 4xx response, and checks that each remote listed in `registry/envs/dev` renders. Each remote's `App` carries `data-testid="<name>"`.

## Configure it

There are no install options. These are the settings you are most likely to change:

| Setting         | Where                   | Default                                                  |
| --------------- | ----------------------- | -------------------------------------------------------- |
| `BASE_URL`      | environment variable    | `http://localhost:4300`, with `pnpm dev` started for you |
| Test file match | `vitest.config.ts`      | `src/**/*.test.{ts,tsx}`                                 |
| Mock handlers   | `src/mocks/handlers.ts` | one handler for `/api/health`                            |

Run the same smoke test against a deployed shell:

```sh
BASE_URL=https://staging.example.com pnpm test:e2e
```

## How it works

The setup file starts the MSW server before the tests, and after each test it cleans up rendered components, calls `resetPlatform()` and resets handlers. `resetPlatform()` clears web storage, the i18n instance, the theme on the root element and remote error reports, so one test cannot leak into the next.

The server treats unhandled requests as errors, so a request nothing answers fails the test. The root Vitest config runs every app's own config as a project.

Playwright starts `pnpm dev` unless `BASE_URL` is set. Its reports and traces go to `node_modules/.cache/playwright`, not your working tree.

## Gotchas

- The Vitest config dedupes React, i18n and Testing Library, so a linked package never brings a second copy of React into a test. The packages it lists under `resolve.dedupe` are:

```text
react
react-dom
react-i18next
i18next
@testing-library/react
```

- The smoke test reads remote names from `registry/envs/dev`, so a remote that is not registered there is not checked.
- If your project has runtime config, the smoke test also waits for `__MFE_RUNTIME_CONFIG__` to be loaded before it finishes.

## Reference

- [ci-github](/features/ci-github), which runs both commands on pull requests
- [http](/features/http)
- [Development workflow](/guide/development)
