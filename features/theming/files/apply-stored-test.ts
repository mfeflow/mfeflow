import { afterEach, describe, expect, it } from 'vitest';
import { applyStoredTheme, startingTheme } from './apply-stored';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('applyStoredTheme', () => {
  it('uses the default theme when nothing is stored', () => {
    expect(startingTheme().name).toBe('light');
  });

  it('puts the stored theme on <html> with its variables', () => {
    localStorage.setItem('shell:theme', JSON.stringify('dark'));
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--mf-color-bg')).not.toBe('');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem('shell:theme', '{broken');
    expect(startingTheme().name).toBe('light');
    localStorage.setItem('shell:theme', JSON.stringify('purple'));
    expect(startingTheme().name).toBe('light');
  });
});
