import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { combinations, featuresOf, find, presetOf, runsE2e, runsUiE2e, stepsFor } from './combos';

describe('combinations', () => {
  it('has 59 with unique ids: the old 16, env/testing/ci on lint + url-factory, two validators, analytics + telemetry, event-bus + route-factory + http, and the react-scale features', () => {
    const all = combinations();
    expect(all).toHaveLength(59);
    expect(new Set(all.map((c) => c.id)).size).toBe(59);
    expect(all.filter((c) => !c.env && !c.testing && !c.ci && !c.commit)).toHaveLength(16);
    expect(all.filter((c) => c.remotes === 1)).toHaveLength(40);
    expect(all.filter((c) => c.gtm || c.otel)).toHaveLength(10);
    expect(all.filter((c) => c.bus || c.routes || c.http)).toHaveLength(9);
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
      'lint-url-env-testing-ci-gtm-otel-bus-routes-http-r3',
      'lint-url-env-testing-bus-r1',
      'lint-url-env-testing-routes-r1',
      'lint-url-env-testing-http-r1',
      'lint-url-testing-bus-routes-http-r1',
      'lint-url-env-valibot-testing-bus-routes-http-r1',
      'lint-url-env-arktype-testing-bus-routes-http-r1',
    ]) {
      expect(ids).toContain(id);
    }
    expect(all.filter((c) => c.validator !== 'zod').every((c) => c.env)).toBe(true);
  });

  it('adds the react-scale features in targeted combinations, not in every one', () => {
    const all = combinations();
    const ids = all.map((c) => c.id);
    for (const id of [
      'lint-url-env-testing-ci-theme-i18n-tw-shadcn-sb-r3',
      'lint-url-testing-theme-i18n-tw-r1',
      'lint-url-env-testing-tw-shadcn-r1',
      'lint-url-env-testing-forms-r1',
      'lint-url-env-testing-forms-formsvalibot-r1',
      'lint-url-testing-forms-formsarktype-r1',
      'lint-url-env-testing-http-query-r1',
      'lint-url-testing-query-r1',
      'lint-url-env-testing-gtm-clarity-r1',
      'lint-url-testing-gtm-clarity-r1',
      'lint-url-hooks-commit-r1',
      'commit-r1',
    ]) {
      expect(ids).toContain(id);
    }
    expect(
      all.filter((c) => c.theme || c.i18n || c.tailwind || c.shadcn || c.storybook),
    ).toHaveLength(5);
    expect(all.filter((c) => c.forms)).toHaveLength(4);
    expect(all.filter((c) => c.query)).toHaveLength(3);
    expect(all.filter((c) => c.clarity)).toHaveLength(3);
    expect(all.filter((c) => c.commit)).toHaveLength(3);
  });

  it('runs the browser test on the full set with analytics and telemetry, with and without the platform features, and the one with every feature, and no other new one', () => {
    const both = combinations().filter((c) => c.gtm && c.otel);
    expect(both.filter(runsE2e).map((c) => c.id)).toEqual([
      'lint-url-env-testing-ci-gtm-otel-r3',
      'lint-url-env-testing-ci-gtm-otel-bus-routes-http-r3',
      'lint-url-hooks-env-testing-ci-gtm-otel-bus-routes-http-theme-i18n-tw-shadcn-forms-query-clarity-sb-commit-r3',
    ]);
    expect(both.some((c) => !c.env)).toBe(true);
  });
});

describe('the browser tests for tokens, theme, language and Storybook', () => {
  it('run only where the three UI features and the full test set are on, with three remotes', () => {
    const ui = combinations().filter(runsUiE2e);
    expect(ui.map((c) => c.id)).toEqual([
      'lint-url-env-testing-ci-theme-i18n-tw-shadcn-sb-r3',
      'lint-url-hooks-env-testing-ci-gtm-otel-bus-routes-http-theme-i18n-tw-shadcn-forms-query-clarity-sb-commit-r3',
    ]);
    expect(ui.every((c) => c.remotes === 3 && c.testing && c.ci)).toBe(true);
  });

  it('builds the composed Storybook after the build steps and before the browser test', () => {
    const names = stepsFor(find(['lint-url-env-testing-ci-theme-i18n-tw-shadcn-sb-r3'])[0]!).map(
      (s) => s.name,
    );
    expect(names.indexOf('storybook:build')).toBeGreaterThan(names.indexOf('build'));
    expect(names.indexOf('storybook:build')).toBeLessThan(names.indexOf('test:e2e'));
    expect(stepsFor(find(['lint-url-env-testing-sb-r1'])[0]!).map((s) => s.name)).toContain(
      'storybook:build',
    );
  });

  it('passes the forms library to the feature through the preset', () => {
    const c = find(['lint-url-env-testing-forms-formsvalibot-r1'])[0]!;
    expect(presetOf(c).options).toEqual({
      'env-t3': { validator: 'zod' },
      forms: { validator: 'valibot' },
    });
    expect(featuresOf(c)).toContain('forms');
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

  it('adds event-bus before route-factory, which looks for the contracts package, and http last', () => {
    const c = find(['lint-url-env-testing-ci-gtm-otel-bus-routes-http-r3'])[0]!;
    expect(featuresOf(c)).toEqual([
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
      'analytics-gtm',
      'telemetry-otel',
      'event-bus',
      'route-factory',
      'http',
      'ci-github',
    ]);
  });

  it('passes the validator choice to env-t3 through the preset', () => {
    const c = find(['lint-url-env-arktype-testing-r1'])[0]!;
    expect(featuresOf(c)).toEqual(['lint-oxlint', 'url-factory', 'env-t3', 'testing']);
    expect(presetOf(c).options).toEqual({ 'env-t3': { validator: 'arktype' } });
  });
});

describe('the matrix workflow', () => {
  it('installs the browser for exactly the combinations that run the browser test', () => {
    const yml = fs.readFileSync(
      path.join(import.meta.dirname, '../../.github/workflows/matrix.yml'),
      'utf8',
    );
    const conditions = [...yml.matchAll(/playwright install.*\n\s*(?:#.*\n\s*)?if: (.+)/g)].map(
      (m) => m[1]!,
    );
    expect(conditions.length).toBeGreaterThan(0);
    for (const condition of conditions) {
      const clauses = condition.split(' && ').map((clause) => {
        const m = /^(endsWith|contains)\(matrix\.combo, '([^']*)'\)$/.exec(clause.trim());
        if (!m) throw new Error(`the test does not understand "${clause}"`);
        return { fn: m[1], text: m[2]! };
      });
      const installs = (id: string): boolean =>
        clauses.every((c) => (c.fn === 'endsWith' ? id.endsWith(c.text) : id.includes(c.text)));
      for (const c of combinations()) expect([c.id, installs(c.id)]).toEqual([c.id, runsE2e(c)]);
    }
  });
});
