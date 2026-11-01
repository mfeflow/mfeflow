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
  validator: Validator;
  remotes: 1 | 3;
}

export interface Step {
  name: string;
  command: 'mfeflow' | 'pnpm' | 'internal';
  args: string[];
}

const REMOTE_NAMES = ['catalog', 'cart', 'checkout'];

type Flags = Partial<
  Pick<Combo, 'lint' | 'url' | 'hooks' | 'env' | 'testing' | 'ci' | 'gtm' | 'otel' | 'validator'>
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
    validator: 'zod' as Validator,
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
 * and both on the other two validators (their schema keys are written per validator).
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
    ...(combo.ci ? ['ci-github'] : []),
    ...(combo.hooks ? ['git-hooks'] : []),
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
    ...(combo.env ? { options: { 'env-t3': { validator: combo.validator } } } : {}),
  };
}

/** Whether the Playwright smoke test runs: it needs a browser, so only on the three-remote runs of the full set. */
export const runsE2e = (combo: Combo): boolean =>
  combo.testing && combo.remotes === 3 && combo.env && combo.ci;

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
    ...(runsE2e(combo)
      ? [{ name: 'test:e2e', command: 'pnpm', args: ['test:e2e'] } satisfies Step]
      : []),
    ...(combo.env ? [{ name: 'env-checks', command: 'internal', args: [] } satisfies Step] : []),
  ];
}
