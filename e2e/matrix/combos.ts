// Every supported combination of the first-party features. `core` and `tsconfig` are always on.

export type Validator = 'zod' | 'valibot' | 'arktype';

export interface Combo {
  id: string;
  lint: boolean;
  url: boolean;
  hooks: boolean;
  env: boolean;
  testing: boolean;
  ci: boolean;
  gtm: boolean;
  otel: boolean;
  bus: boolean;
  routes: boolean;
  http: boolean;
  theme: boolean;
  i18n: boolean;
  tailwind: boolean;
  shadcn: boolean;
  forms: boolean;
  query: boolean;
  clarity: boolean;
  storybook: boolean;
  commit: boolean;
  validator: Validator;
  /** The schema library of the forms feature, which is its own option. */
  formsValidator: Validator;
  remotes: 1 | 3;
}

export interface Step {
  name: string;
  command: 'mfeflow' | 'pnpm' | 'internal';
  args: string[];
}

export const REMOTE_NAMES = ['catalog', 'cart', 'checkout'];

type Flags = Partial<
  Pick<
    Combo,
    | 'lint'
    | 'url'
    | 'hooks'
    | 'env'
    | 'testing'
    | 'ci'
    | 'gtm'
    | 'otel'
    | 'bus'
    | 'routes'
    | 'http'
    | 'theme'
    | 'i18n'
    | 'tailwind'
    | 'shadcn'
    | 'forms'
    | 'query'
    | 'clarity'
    | 'storybook'
    | 'commit'
    | 'validator'
    | 'formsValidator'
  >
>;

function make(flags: Flags, remotes: 1 | 3): Combo {
  const combo = {
    lint: false,
    url: false,
    hooks: false,
    env: false,
    testing: false,
    ci: false,
    gtm: false,
    otel: false,
    bus: false,
    routes: false,
    http: false,
    theme: false,
    i18n: false,
    tailwind: false,
    shadcn: false,
    forms: false,
    query: false,
    clarity: false,
    storybook: false,
    commit: false,
    validator: 'zod' as Validator,
    formsValidator: 'zod' as Validator,
    ...flags,
  };
  const parts = [
    combo.lint ? 'lint' : '',
    combo.url ? 'url' : '',
    combo.hooks ? 'hooks' : '',
    combo.env ? 'env' : '',
    combo.env && combo.validator !== 'zod' ? combo.validator : '',
    combo.testing ? 'testing' : '',
    combo.ci ? 'ci' : '',
    combo.gtm ? 'gtm' : '',
    combo.otel ? 'otel' : '',
    combo.bus ? 'bus' : '',
    combo.routes ? 'routes' : '',
    combo.http ? 'http' : '',
    combo.theme ? 'theme' : '',
    combo.i18n ? 'i18n' : '',
    combo.tailwind ? 'tw' : '',
    combo.shadcn ? 'shadcn' : '',
    combo.forms ? 'forms' : '',
    combo.forms && combo.formsValidator !== 'zod' ? `forms${combo.formsValidator}` : '',
    combo.query ? 'query' : '',
    combo.clarity ? 'clarity' : '',
    combo.storybook ? 'sb' : '',
    combo.commit ? 'commit' : '',
  ].filter((p) => p !== '');
  return {
    ...combo,
    id: `${parts.length > 0 ? parts.join('-') : 'bare'}-r${String(remotes)}`,
    remotes,
  };
}

/**
 * 16 for lint, url-factory and git-hooks alone; then env-t3, testing and ci-github in every
 * combination on top of lint + url-factory (the old default set), and one run each for the
 * valibot and arktype validators. All with one or three remotes. Then analytics-gtm and
 * telemetry-otel: the full set with both (the one that runs the browser test), each alone on the
 * default set, both without env-t3 (their runtime keys go to public/config/runtime-config.json),
 * and both on the other two validators (their schema keys are written per validator). Then
 * event-bus, route-factory and http: all three together with everything else on three remotes
 * (the second one that runs the browser test), each alone on the default set, all three without env-t3 (http's runtime key goes to
 * public/config/runtime-config.json), and all three on the other two validators. Then the react-scale
 * features: theming + i18n + tailwind + ui-shadcn + storybook on three remotes with ci (runs the browser tests
 * for tokens, theme, language and the composed Storybook), the same without env-t3, tailwind and the data
 * and form features each alone, clarity next to gtm with and without env-t3, the commit prompt on its own
 * and beside git-hooks, and one run of everything together.
 */
export function combinations(): Combo[] {
  const flags = [false, true];
  const out: Combo[] = [];
  for (const lint of flags)
    for (const url of flags)
      for (const hooks of flags)
        for (const remotes of [1, 3] as const) out.push(make({ lint, url, hooks }, remotes));
  for (const env of flags)
    for (const testing of flags)
      for (const ci of flags) {
        if (!env && !testing && !ci) continue;
        for (const remotes of [1, 3] as const)
          out.push(make({ lint: true, url: true, env, testing, ci }, remotes));
      }
  for (const validator of ['valibot', 'arktype'] as const) {
    out.push(make({ lint: true, url: true, env: true, testing: true, validator }, 1));
  }
  const base = { lint: true, url: true, env: true, testing: true };
  out.push(make({ ...base, ci: true, gtm: true, otel: true }, 3));
  out.push(make({ ...base, gtm: true }, 1));
  out.push(make({ ...base, otel: true }, 1));
  out.push(make({ ...base, env: false, gtm: true, otel: true }, 1));
  for (const validator of ['valibot', 'arktype'] as const) {
    out.push(make({ ...base, gtm: true, otel: true, validator }, 1));
  }
  const platform = { bus: true, routes: true, http: true };
  out.push(make({ ...base, ci: true, gtm: true, otel: true, ...platform }, 3));
  out.push(make({ ...base, bus: true }, 1));
  out.push(make({ ...base, routes: true }, 1));
  out.push(make({ ...base, http: true }, 1));
  out.push(make({ ...base, env: false, ...platform }, 1));
  for (const validator of ['valibot', 'arktype'] as const) {
    out.push(make({ ...base, ...platform, validator }, 1));
  }
  const ui = { theme: true, i18n: true, tailwind: true, shadcn: true };
  out.push(make({ ...base, ci: true, ...ui, storybook: true }, 3));
  out.push(make({ ...base, env: false, theme: true, i18n: true, tailwind: true }, 1));
  out.push(make({ ...base, tailwind: true, shadcn: true }, 1));
  out.push(make({ ...base, storybook: true }, 1));
  out.push(make({ ...base, http: true, query: true }, 1));
  out.push(make({ ...base, env: false, query: true }, 1));
  out.push(make({ ...base, forms: true }, 1));
  out.push(make({ ...base, forms: true, formsValidator: 'valibot' }, 1));
  out.push(make({ ...base, env: false, forms: true, formsValidator: 'arktype' }, 1));
  out.push(make({ ...base, gtm: true, clarity: true }, 1));
  out.push(make({ ...base, env: false, gtm: true, clarity: true }, 1));
  out.push(make({ lint: true, url: true, hooks: true, commit: true }, 1));
  out.push(make({ commit: true }, 1));
  out.push(
    make(
      {
        ...base,
        ci: true,
        hooks: true,
        gtm: true,
        otel: true,
        ...platform,
        ...ui,
        forms: true,
        query: true,
        clarity: true,
        storybook: true,
        commit: true,
      },
      3,
    ),
  );
  return out;
}

export function find(ids: readonly string[]): Combo[] {
  const all = combinations();
  return ids.map((id) => {
    const found = all.find((c) => c.id === id);
    if (!found) throw new Error(`unknown combination "${id}" (try --list)`);
    return found;
  });
}

export function featuresOf(combo: Combo): string[] {
  return [
    ...(combo.lint ? ['lint-oxlint'] : []),
    ...(combo.url ? ['url-factory'] : []),
    ...(combo.env ? ['env-t3'] : []),
    ...(combo.testing ? ['testing'] : []),
    ...(combo.gtm ? ['analytics-gtm'] : []),
    ...(combo.otel ? ['telemetry-otel'] : []),
    ...(combo.bus ? ['event-bus'] : []),
    ...(combo.routes ? ['route-factory'] : []),
    ...(combo.http ? ['http'] : []),
    ...(combo.theme ? ['theming'] : []),
    ...(combo.i18n ? ['i18n'] : []),
    ...(combo.tailwind ? ['tailwind'] : []),
    ...(combo.shadcn ? ['ui-shadcn'] : []),
    ...(combo.forms ? ['forms'] : []),
    ...(combo.query ? ['data-react-query'] : []),
    ...(combo.clarity ? ['analytics-clarity'] : []),
    ...(combo.storybook ? ['storybook'] : []),
    ...(combo.ci ? ['ci-github'] : []),
    ...(combo.hooks ? ['git-hooks'] : []),
    ...(combo.commit ? ['commit-prompt'] : []),
  ];
}

/** The preset `mfeflow init` replays: an empty feature list is only expressible this way. */
export function presetOf(combo: Combo): {
  remotes: string[];
  features: string[];
  options?: Record<string, Record<string, string>>;
} {
  return {
    remotes: REMOTE_NAMES.slice(0, combo.remotes),
    features: featuresOf(combo),
    ...(combo.env || combo.forms
      ? {
          options: {
            ...(combo.env ? { 'env-t3': { validator: combo.validator } } : {}),
            ...(combo.forms ? { forms: { validator: combo.formsValidator } } : {}),
          },
        }
      : {}),
  };
}

/** Whether the Playwright smoke test runs: it needs a browser, so only on the three-remote runs of the full set. */
export const runsE2e = (combo: Combo): boolean =>
  combo.testing && combo.remotes === 3 && combo.env && combo.ci;

/** Whether the browser test of the colour tokens, the theme and the language runs. */
export const runsUiE2e = (combo: Combo): boolean =>
  runsE2e(combo) && combo.theme && combo.i18n && combo.tailwind;

/** What a person would run on the result, in order. Lint and format only exist with lint-oxlint. */
export function stepsFor(combo: Combo): Step[] {
  return [
    { name: 'install', command: 'pnpm', args: ['install'] },
    { name: 'doctor', command: 'mfeflow', args: ['doctor'] },
    { name: 'build', command: 'pnpm', args: ['build'] },
    { name: 'budget', command: 'mfeflow', args: ['budget'] },
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'] },
    ...(combo.env || combo.testing
      ? [{ name: 'typecheck:tooling', command: 'pnpm', args: ['typecheck:tooling'] } satisfies Step]
      : []),
    ...(combo.lint
      ? [
          { name: 'lint', command: 'pnpm', args: ['lint'] } satisfies Step,
          { name: 'format:check', command: 'pnpm', args: ['format:check'] } satisfies Step,
        ]
      : []),
    ...(combo.testing ? [{ name: 'test', command: 'pnpm', args: ['test'] } satisfies Step] : []),
    { name: 'validate', command: 'mfeflow', args: ['validate'] },
    { name: 'check-compat', command: 'mfeflow', args: ['check-compat'] },
    ...(combo.env
      ? [
          {
            name: 'check:runtime-config',
            command: 'pnpm',
            args: ['check:runtime-config'],
          } satisfies Step,
        ]
      : []),
    ...(combo.storybook
      ? [{ name: 'storybook:build', command: 'pnpm', args: ['storybook:build'] } satisfies Step]
      : []),
    ...(runsE2e(combo)
      ? [{ name: 'test:e2e', command: 'pnpm', args: ['test:e2e'] } satisfies Step]
      : []),
    ...(combo.env ? [{ name: 'env-checks', command: 'internal', args: [] } satisfies Step] : []),
  ];
}
