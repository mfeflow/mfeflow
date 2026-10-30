import { describe, expect, it } from 'vitest';
import { packageInfo } from './index.js';

describe('@mfeflow/core', () => {
  it('reports its name and version', () => {
    expect(packageInfo().name).toBe('@mfeflow/core');
    expect(packageInfo().version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
