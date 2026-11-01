import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

describe('tokens', () => {
  it('are the shell variables, with a fallback for standalone runs', () => {
    expect(tokens.primary).toBe('var(--mf-color-primary, #2563eb)');
    expect(tokens.fg).toContain('--mf-color-fg');
  });
});
