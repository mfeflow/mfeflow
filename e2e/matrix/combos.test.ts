import { describe, expect, it } from 'vitest';
import { combinations, featuresOf, find, presetOf, stepsFor } from './combos';

describe('combinations', () => {
  it('has all 16 once, with unique ids', () => {
    const all = combinations();
    expect(all).toHaveLength(16);
    expect(new Set(all.map((c) => c.id)).size).toBe(16);
    expect(all.filter((c) => c.remotes === 1)).toHaveLength(8);
    expect(all.map((c) => c.id)).toContain('bare-r1');
    expect(all.map((c) => c.id)).toContain('lint-url-hooks-r3');
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
});
