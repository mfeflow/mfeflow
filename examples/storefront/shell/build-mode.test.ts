import { describe, expect, it } from 'vitest';
import { buildModeConfig } from './build-mode';

describe('buildModeConfig', () => {
  it('turns hot reload off and writes dist-dev only for the dev-build env mode', () => {
    expect(buildModeConfig('dev-build')).toEqual({
      output: { distPath: { root: 'dist-dev' } },
      dev: { hmr: false },
    });
  });

  it('leaves hot reload alone for dev and production', () => {
    for (const mode of [undefined, 'development', 'production']) {
      const config = buildModeConfig(mode);
      expect(config.dev).toBeUndefined();
      expect(config.output?.distPath).toEqual({ root: 'dist' });
    }
  });
});
