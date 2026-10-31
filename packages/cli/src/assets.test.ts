import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetRoots } from './assets';
import { REPO } from './testing';

describe('assetRoots', () => {
  it('uses the assets folder next to dist when it is there', () => {
    const roots = assetRoots(
      path.resolve('/pkg/dist'),
      (dir) => dir === path.resolve('/pkg/assets/features'),
    );
    expect(roots).toEqual({
      features: path.resolve('/pkg/assets/features'),
      templates: path.resolve('/pkg/assets/templates'),
    });
  });

  it('falls back to the repository root in a checkout', () => {
    const roots = assetRoots(path.resolve('/repo/packages/cli/src'), () => false);
    expect(roots).toEqual({
      features: path.resolve('/repo/features'),
      templates: path.resolve('/repo/templates'),
    });
  });

  it('prefers the checkout over a stale assets copy when running from src', () => {
    const roots = assetRoots(path.resolve('/repo/packages/cli/src'), () => true);
    expect(roots).toEqual({
      features: path.resolve('/repo/features'),
      templates: path.resolve('/repo/templates'),
    });
  });

  it('reads the checkout, not packages/cli/assets, when the tests run from src', () => {
    expect(assetRoots()).toEqual({
      features: path.join(REPO, 'features'),
      templates: path.join(REPO, 'templates'),
    });
  });
});
