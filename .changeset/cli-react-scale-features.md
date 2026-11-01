---
'mfeflow': minor
---

Add nine features carried over from react-scale: `theming` (the shell owns the theme provider and the stored choice, every remote reads the `--mf-*` tokens), `i18n` (one i18next instance from the shell, messages per remote loaded from the remote's own deploy, `lang` and `dir`), `tailwind` (Tailwind 4 with the reset in the shell only and a class prefix per app), `ui-shadcn` (components.json, `cn` and a Button per remote), `forms` (react-hook-form with zod, valibot or arktype), `data-react-query` (a shared QueryClient with a query-key prefix per remote), `storybook` (Storybook 10 per remote, composed in the shell's), `analytics-clarity` (Microsoft Clarity after analytics consent, runtime key `clarityId`) and `commit-prompt` (`pnpm commit`). The generated `pnpm-workspace.yaml` now lists `esbuild: false` under `allowBuilds`, the generated `analytics-gtm` start-up uses `addProvider`, and the testing feature's vitest config dedupes `react-i18next` and `i18next`.
