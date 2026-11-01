import cli from '../../../../packages/cli/package.json';

export const VERSION: string = cli.version;
export const INSTALL_COMMAND = 'pnpm create mfeflow my-platform';
export const REPO_URL = 'https://github.com/mfeflow/mfeflow';
export const NPM_URL = 'https://www.npmjs.com/package/mfeflow';
export const CHANGELOG_URL =
  'https://github.com/mfeflow/mfeflow/blob/main/packages/cli/CHANGELOG.md';

/** Features that have a page under /features. Chips for any other feature render without a link. */
export const DOCUMENTED_FEATURES: readonly string[] = [
  'analytics-clarity',
  'analytics-gtm',
  'ci-github',
  'commit-prompt',
  'data-react-query',
  'env-t3',
  'event-bus',
  'forms',
  'http',
  'i18n',
  'route-factory',
  'storybook',
  'tailwind',
  'telemetry-otel',
  'testing',
  'theming',
  'ui-shadcn',
];

export const FEATURE_GROUPS = [
  {
    title: 'Foundation',
    features: ['tsconfig', 'lint-oxlint', 'testing', 'git-hooks', 'commit-prompt', 'ci-github'],
  },
  {
    title: 'Data and contracts',
    features: [
      'env-t3',
      'url-factory',
      'http',
      'route-factory',
      'event-bus',
      'data-react-query',
      'forms',
    ],
  },
  { title: 'Observability', features: ['analytics-gtm', 'analytics-clarity', 'telemetry-otel'] },
  { title: 'UI', features: ['theming', 'i18n', 'tailwind', 'ui-shadcn', 'storybook'] },
] as const;

export const STATS = [
  {
    value: '5.3 s',
    label: 'create to a running shell + 2 remotes',
    source: 'bench, median of 5, warm pnpm store',
  },
  {
    value: '+160 ms',
    label: 'LCP against the same pages built as one app',
    source: 'Lighthouse mobile, median of 10, budget 300 ms',
  },
  { value: '21', label: 'features, each one command away', source: 'mfeflow add <feature>' },
  { value: '18', label: 'packages, versioned together', source: 'MIT, npm provenance' },
] as const;

export const STEPS = [
  {
    n: '01',
    title: 'Create',
    code: 'pnpm create mfeflow my-platform',
    text: 'A shell, the remotes you name and the features you pick, in a pnpm and Turborepo monorepo.',
  },
  {
    n: '02',
    title: 'Add',
    code: 'pnpm mfeflow add event-bus http',
    text: 'Typed events between remotes, a fetch client over typed URLs. One command each.',
  },
  {
    n: '03',
    title: 'Develop',
    code: 'pnpm mfeflow dev',
    text: 'The shell and every remote on their own ports, with a dev registry that follows new remotes.',
  },
  {
    n: '04',
    title: 'Check',
    code: 'pnpm mfeflow doctor && pnpm mfeflow budget',
    text: 'One React, one tracer, one tag manager. Bundle budgets in CI, with fixes it can apply.',
  },
] as const;

export const GUARDRAILS = [
  {
    title: 'Singletons, checked',
    text: 'React and other stateful libraries are shared once and checked at build and at run time, so two copies never ship.',
  },
  {
    title: 'Budgets in CI',
    text: 'The perf job holds LCP to +300 ms, the shell to +32 KB and each remote to +10 KB over the same pages built as one app.',
  },
  {
    title: 'Ownership in the repo',
    text: 'Each remote has an mfe.json with its owner, routes and contracts, so check-compat and doctor know who breaks what.',
  },
  {
    title: 'Declarative third parties',
    text: 'A registry feature can add files, dependencies and namespaced scripts. It cannot run code on install or touch your CI.',
  },
] as const;

export const REGISTRY_CARDS = [
  { name: 'catalog@2.3.1', note: 'stored, immutable', accent: false },
  { name: 'catalog@2.4.0', note: 'stored, immutable', accent: false },
  { name: 'index.json', note: 'prod points at one version', accent: true },
] as const;

export const DESCRIPTION =
  'React micro-frontend boilerplate and platform kit for Module Federation 2.0: à-la-carte features, a self-hosted registry designed for rollback by pointer.';
