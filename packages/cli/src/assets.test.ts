import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetRoots } from './assets';

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

  it('finds the real folders from here', () => {
    const roots = assetRoots();
    expect(path.basename(roots.features)).toBe('features');
    expect(path.basename(roots.templates)).toBe('templates');
  });
});
