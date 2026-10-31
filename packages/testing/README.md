# @mfeflow/testing

Test helpers for mfeflow micro-frontends. `renderWithPlatform` renders a component inside the same providers the shell uses; `resetPlatform` clears storage, the i18n instance, the theme on `<html>` and remote error reports between tests.

## Install

```sh
pnpm add -D @mfeflow/testing @testing-library/react @testing-library/dom react react-dom
```

`@testing-library/react` (^16), `react` and `react-dom` (^19) are peer dependencies; Testing Library also needs `@testing-library/dom`. `renderWithPlatform` imports only `@mfeflow/runtime/providers`, so Module Federation is not loaded in your tests. Run tests in a DOM environment such as jsdom.

## Usage

```tsx
import { afterEach, expect, test } from 'vitest';
import { withProps } from '@mfeflow/runtime';
import { ThemeProvider } from '@mfeflow/theme/react';
import { renderWithPlatform, resetPlatform } from '@mfeflow/testing';
import { themes } from './themes';

afterEach(resetPlatform);

test('renders with the shell providers', () => {
  const { getByText } = renderWithPlatform(<Cart />, {
    providers: [withProps(ThemeProvider, { themes, defaultTheme: 'light' })],
  });
  expect(getByText('Cart')).toBeTruthy();
});
```

## Module Federation sharing

Bucket: **config**. Used at build, lint or test time only, never shipped to the browser, so it is not shared through Module Federation.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [mfeflow.dev](https://mfeflow.dev) (documentation, coming soon)

MIT licensed.
