import { describe, expect, it } from 'vitest';
import { packageInfo } from './index.js';

describe('@mfeflow/contracts', () => {
  it('reports its name and version', () => {
    expect(packageInfo().name).toBe('@mfeflow/contracts');
    expect(packageInfo().version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
