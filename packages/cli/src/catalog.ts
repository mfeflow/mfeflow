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
  { name: 'forms', always: false, default: false },
  { name: 'ci-github', always: false, default: false },
  { name: 'git-hooks', always: false, default: false },
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

async function loadFirstParty(name: string, roots: AssetRoots): Promise<LoadedFeature> {
  if (name !== 'core') return loadFeature(name, { featuresDir: roots.features });
  const dir = path.join(roots.templates, 'monorepo');
  let text: string;
  try {
    text = await realFs.readFile(path.join(dir, 'feature.json'));
  } catch (error) {
    throw new MfeflowError('E201', `core (looked in ${dir})`, { cause: error });
  }
  return {
    manifest: parseFeature(text, 'first-party', 'core/feature.json'),
    trust: 'first-party',
    readAsset: async (relative) => {
      if (!isSafeRelativePath(relative)) throw new MfeflowError('E105', `"${relative}"`);
      return realFs.readFile(path.join(dir, ...relative.split('/')));
    },
  };
}

export interface FeatureSource {
  roots: AssetRoots;
  registries?: Record<string, string> | undefined;
  fetch?: FetchLike | undefined;
  /** The version to ask a registry for, when its URL template can pin one. */
  version?: string | undefined;
}

/** A first-party feature by name, or `@namespace/name` from a configured registry. */
export function loadAny(name: string, source: FeatureSource): Promise<LoadedFeature> {
  if (isFirstParty(name)) return loadFirstParty(name, source.roots);
  return loadFeature(name, {
    featuresDir: source.roots.features,
    ...(source.registries ? { registries: source.registries } : {}),
    ...(source.fetch ? { fetch: source.fetch } : {}),
    ...(source.version === undefined ? {} : { version: source.version }),
  });
}
