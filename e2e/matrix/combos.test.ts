import { describe, expect, it } from 'vitest';
import { combinations, featuresOf, find, presetOf, runsE2e, stepsFor } from './combos';

describe('combinations', () => {
  it('has 38 with unique ids: the old 16, env/testing/ci on lint + url-factory, two validators, and analytics + telemetry', () => {
    const all = combinations();
    expect(all).toHaveLength(38);
    expect(new Set(all.map((c) => c.id)).size).toBe(38);
    expect(all.filter((c) => !c.env && !c.testing && !c.ci)).toHaveLength(16);
    expect(all.filter((c) => c.remotes === 1)).toHaveLength(22);
    expect(all.filter((c) => c.gtm || c.otel)).toHaveLength(6);
    const ids = all.map((c) => c.id);
    for (const id of [
      'bare-r1',
      'lint-url-hooks-r3',
      'lint-url-env-testing-ci-r3',
      'lint-url-env-valibot-testing-r1',
      'lint-url-env-arktype-testing-r1',
      'lint-url-env-testing-ci-gtm-otel-r3',
      'lint-url-env-testing-gtm-r1',
      'lint-url-env-testing-otel-r1',
      'lint-url-testing-gtm-otel-r1',
    ]) {
      expect(ids).toContain(id);
    }
    expect(all.filter((c) => c.validator !== 'zod').every((c) => c.env)).toBe(true);
  });

  it('runs the browser test on the full set with both analytics and telemetry, and no other new one', () => {
    const both = combinations().filter((c) => c.gtm && c.otel);
    expect(both.filter(runsE2e).map((c) => c.id)).toEqual(['lint-url-env-testing-ci-gtm-otel-r3']);
    expect(both.some((c) => !c.env)).toBe(true);
  });
});

describe('find', () => {
  it('returns combinations by id and refuses an unknown one', () => {
    expect(find(['lint-r3']).map((c) => c.id)).toEqual(['lint-r3']);
    expect(() => find(['nope'])).toThrow('unknown combination "nope"');
  });
});

describe('what a combination generates', () => {
  it('lists its features in catalogue order and its remotes by name', () => {
    const all = find(['lint-url-hooks-r3'])[0];
    expect(all && featuresOf(all)).toEqual(['lint-oxlint', 'url-factory', 'git-hooks']);
    expect(all && presetOf(all)).toEqual({
      remotes: ['catalog', 'cart', 'checkout'],
      features: ['lint-oxlint', 'url-factory', 'git-hooks'],
    });
    const bare = find(['bare-r1'])[0];
    expect(bare && presetOf(bare)).toEqual({ remotes: ['catalog'], features: [] });
  });

  it('runs lint and format only when lint-oxlint is on', () => {
    const names = (id: string) => stepsFor(find([id])[0]!).map((s) => s.name);
    expect(names('bare-r1')).not.toContain('lint');
    expect(names('url-r1')).not.toContain('format:check');
    expect(names('lint-r1')).toEqual(expect.arrayContaining(['lint', 'format:check']));
    expect(names('lint-r1').slice(0, 4)).toEqual(['install', 'doctor', 'build', 'budget']);
  });

  it('adds the env, test and e2e steps only where the features are on', () => {
    const names = (id: string) => stepsFor(find([id])[0]!).map((s) => s.name);
    expect(names('lint-url-r1')).not.toContain('test');
    expect(names('lint-url-r1')).not.toContain('env-checks');
    expect(names('lint-url-env-r1')).toEqual(
      expect.arrayContaining(['check:runtime-config', 'env-checks']),
    );
    expect(names('lint-url-testing-r1')).toContain('test');
    const full = names('lint-url-env-testing-ci-r3');
    expect(full.indexOf('test:e2e')).toBeGreaterThan(-1);
    expect(full.indexOf('test:e2e')).toBeLessThan(full.indexOf('env-checks'));
    expect(full.filter((n) => n === 'test:e2e')).toHaveLength(1);
    expect(find(['lint-url-env-testing-ci-r1']).some(runsE2e)).toBe(false);
  });

  it('adds the two features after env-t3 and testing, so the config schema exists when they edit it', () => {
    const c = find(['lint-url-env-testing-ci-gtm-otel-r3'])[0]!;
    expect(featuresOf(c)).toEqual([
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
      'analytics-gtm',
      'telemetry-otel',
      'ci-github',
    ]);
  });

  it('passes the validator choice to env-t3 through the preset', () => {
    const c = find(['lint-url-env-arktype-testing-r1'])[0]!;
    expect(featuresOf(c)).toEqual(['lint-oxlint', 'url-factory', 'env-t3', 'testing']);
    expect(presetOf(c).options).toEqual({ 'env-t3': { validator: 'arktype' } });
  });
});
