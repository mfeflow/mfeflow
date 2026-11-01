# @mfeflow/i18n

Internationalisation for micro-frontends. The shell owns one i18next instance; each remote lazy-loads its own namespace from its own deploy. It sets `lang` and `dir` (RTL) on `<html>` and persists the chosen language.

## Install

```sh
pnpm add @mfeflow/i18n i18next react-i18next react
```

`i18next` (26), `react-i18next` (17) and `react` (19) are peer dependencies. All three are required, even if you only use the root entry: it registers `react-i18next` with the i18next instance.

## Usage

In the shell, once, before rendering:

```ts
import { initI18n } from '@mfeflow/i18n';

await initI18n({
  languages: [
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
  ],
  defaultLanguage: 'en',
  resources: { en: { shell: { title: 'Store' } } },
});
```

In a remote:

```tsx
import { useMfeTranslation } from '@mfeflow/i18n/react';

function Cart() {
  const { t, ready } = useMfeTranslation('cart', (lng) => import(`./i18n/${lng}.json`));
  return ready ? <h1>{t('title')}</h1> : null;
}
```

`useLanguage()` returns the current language, the configured list and `setLanguage(code)` for a picker.

## Module Federation sharing

Bucket: **singleton**. This package keeps page-wide state, so the shell and every remote must use one copy. `@mfeflow/rsbuild` shares it as a Module Federation singleton by default (`createShellConfig` and `createRemoteConfig`); if you configure sharing by hand, mark it `singleton: true`.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
