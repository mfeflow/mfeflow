import path from 'node:path';
import { isSafeRelativePath } from '@mfeflow/contracts';
import {
  loadFeature,
  MfeflowError,
  parseFeature,
  realFs,
  type FetchLike,
  type LoadedFeature,
} from '@mfeflow/core';
import type { AssetRoots } from './assets';

export interface FirstPartyFeature {
  name: string;
  /** Part of every project; not offered as a choice. */
  always: boolean;
  /** Selected by default in `init`. */
  default: boolean;
}

/** The features that ship with mfeflow, in the order they are applied. */
export const FIRST_PARTY: readonly FirstPartyFeature[] = [
  { name: 'core', always: true, default: true },
  { name: 'tsconfig', always: true, default: true },
  { name: 'lint-oxlint', always: false, default: true },
  { name: 'url-factory', always: false, default: true },
  { name: 'env-t3', always: false, default: true },
  { name: 'testing', always: false, default: true },
  { name: 'analytics-gtm', always: false, default: false },
  { name: 'telemetry-otel', always: false, default: false },
  { name: 'event-bus', always: false, default: false },
  { name: 'route-factory', always: false, default: false },
  { name: 'http', always: false, default: false },
  { name: 'theming', always: false, default: false },
  { name: 'i18n', always: false, default: false },
  { name: 'tailwind', always: false, default: false },
  { name: 'ui-shadcn', always: false, default: false },
  { name: 'forms', always: false, default: false },
  { name: 'data-react-query', always: false, default: false },
  { name: 'analytics-clarity', always: false, default: false },
  { name: 'storybook', always: false, default: false },
  { name: 'ci-github', always: false, default: false },
  { name: 'git-hooks', always: false, default: false },
  { name: 'commit-prompt', always: false, default: false },
  { name: 'registry-static', always: false, default: false },
  { name: 'release', always: false, default: false },
  { name: 'registry-server', always: false, default: false },
  { name: 'deploy-cloudflare', always: false, default: false },
  { name: 'deploy-docker', always: false, default: false },
];

export function isFirstParty(name: string): boolean {
  return FIRST_PARTY.some((feature) => feature.name === name);
}

/** The first-party features a user may pick, in catalogue order. */
export const OPTIONAL_FEATURES: readonly string[] = FIRST_PARTY.filter((f) => !f.always).map(
  (f) => f.name,
);

export const DEFAULT_FEATURES: readonly string[] = FIRST_PARTY.filter(
  (f) => !f.always && f.default,
).map((f) => f.name);

/** `polyrepo` is applied by `init --topology polyrepo`; it is not offered by `add` or listed by `features`. */
export const POLYREPO_FEATURE = 'polyrepo';

/** The README and AGENTS.md of a repo of remotes with no shell; applied by `init --kind remote`, not offered by `add`. */
export const REMOTE_ONLY_FEATURE = 'remote-only';

/** The features that live in a `templates/` folder, by the folder that holds them. */
const TEMPLATE_FEATURES: Readonly<Record<string, string>> = {
  core: 'monorepo',
  polyrepo: 'polyrepo',
  [REMOTE_ONLY_FEATURE]: 'remote-only',
};

/** A feature kept in a folder with a `feature.json` and its asset files, as the templates are. */
async function loadFolderFeature(name: string, dir: string): Promise<LoadedFeature> {
  let text: string;
  try {
    text = await realFs.readFile(path.join(dir, 'feature.json'));
  } catch (error) {
    throw new MfeflowError('E201', `${name} (looked in ${dir})`, { cause: error });
  }
  return {
    manifest: parseFeature(text, 'first-party', `${name}/feature.json`),
    trust: 'first-party',
    dir,
    readAsset: async (relative) => {
      if (!isSafeRelativePath(relative)) throw new MfeflowError('E105', `"${relative}"`);
      return realFs.readFile(path.join(dir, ...relative.split('/')));
    },
  };
}

async function loadFirstParty(name: string, roots: AssetRoots): Promise<LoadedFeature> {
  const folder = TEMPLATE_FEATURES[name];
  if (folder === undefined) return loadFeature(name, { featuresDir: roots.features });
  return loadFolderFeature(name, path.join(roots.templates, folder));
}

/** The template of one tooling package, from `templates/tooling/<name>`. */
export function loadToolingPackage(name: string, roots: AssetRoots): Promise<LoadedFeature> {
  return loadFolderFeature(`tooling-${name}`, path.join(roots.templates, 'tooling', name));
}

export interface FeatureSource {
  roots: AssetRoots;
  registries?: Record<string, string> | undefined;
  fetch?: FetchLike | undefined;
  /** The version to ask a registry for, when its URL template can pin one. */
  version?: string | undefined;
  /** Namespaces the user trusts, so their registries may be on loopback or private addresses. */
  trusted?: ReadonlySet<string> | undefined;
  /** Compare the registry index's version with the feature.json's. */
  checkIndex?: boolean | undefined;
}

/** A first-party feature by name, or `@namespace/name` from a configured registry. */
export function loadAny(name: string, source: FeatureSource): Promise<LoadedFeature> {
  if (isFirstParty(name) || name === POLYREPO_FEATURE || name === REMOTE_ONLY_FEATURE) {
    return loadFirstParty(name, source.roots);
  }
  return loadFeature(name, {
    featuresDir: source.roots.features,
    ...(source.registries ? { registries: source.registries } : {}),
    ...(source.fetch ? { fetch: source.fetch } : {}),
    ...(source.version === undefined ? {} : { version: source.version }),
    trusted: source.trusted?.has(name.slice(0, name.indexOf('/'))) === true,
    ...(source.checkIndex === true ? { checkIndex: true } : {}),
  });
}

const rank = (name: string) => OPTIONAL_FEATURES.indexOf(name);

/** First-party features in the order `init` applies them, then the rest as typed: a feature may edit another's files. */
export function inCatalogueOrder(names: readonly string[]): string[] {
  const known = names.filter((n) => rank(n) !== -1).toSorted((a, b) => rank(a) - rank(b));
  return [...known, ...names.filter((n) => rank(n) === -1)];
}
