import { describe, expect, it } from 'vitest';
import { validateFeatureManifest } from '@mfeflow/contracts';
import { assetRoots } from './assets';
import { DEFAULT_FEATURES, FIRST_PARTY, isFirstParty, loadAny, OPTIONAL_FEATURES } from './catalog';
import { failure } from './testing';

const roots = assetRoots();

describe('first-party catalogue', () => {
  it('lists core and tsconfig as always, the rest as choices in order', () => {
    expect(FIRST_PARTY.filter((f) => f.always).map((f) => f.name)).toEqual(['core', 'tsconfig']);
    expect(OPTIONAL_FEATURES).toEqual([
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
      'analytics-gtm',
      'telemetry-otel',
      'event-bus',
      'route-factory',
      'http',
      'theming',
      'i18n',
      'tailwind',
      'forms',
      'data-react-query',
      'ci-github',
      'git-hooks',
    ]);
    expect(DEFAULT_FEATURES).toEqual(['lint-oxlint', 'url-factory', 'env-t3', 'testing']);
    expect(isFirstParty('git-hooks')).toBe(true);
    expect(isFirstParty('analytics-gtm')).toBe(true);
    expect(isFirstParty('analytics-segment')).toBe(false);
  });

  it('loads every feature, valid and named as listed, with readable assets', async () => {
    for (const { name } of FIRST_PARTY) {
      const feature = await loadAny(name, { roots });
      expect(feature.manifest.name).toBe(name);
      expect(feature.trust).toBe('first-party');
      expect(validateFeatureManifest(feature.manifest)).toEqual([]);
      for (const file of feature.manifest.files ?? []) {
        if (file.content !== undefined) continue;
        expect(file.from).toBeDefined();
        expect((await feature.readAsset?.(file.from ?? '')) ?? '').not.toBe('');
      }
    }
  });

  it('refuses an asset path that leaves the feature, for core too', async () => {
    const core = await loadAny('core', { roots });
    expect((await failure(core.readAsset?.('../x') ?? Promise.resolve())).code).toBe(
      'MFEFLOW_E105',
    );
  });

  it('reports an unknown feature as E201, and a missing core template as E201', async () => {
    expect((await failure(loadAny('nope', { roots }))).code).toBe('MFEFLOW_E201');
    expect(
      (await failure(loadAny('core', { roots: { ...roots, templates: '/nowhere' } }))).code,
    ).toBe('MFEFLOW_E201');
  });

  it('asks the project registries for a namespaced feature', async () => {
    const error = await failure(loadAny('@acme/x', { roots, registries: {} }));
    expect(error.code).toBe('MFEFLOW_E210');
  });
});
