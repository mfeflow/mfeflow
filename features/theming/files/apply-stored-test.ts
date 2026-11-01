import { afterEach, describe, expect, it } from 'vitest';
import { applyStoredTheme, currentStartingTheme } from './apply-stored';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('applyStoredTheme', () => {
  it('uses the default theme when nothing is stored', () => {
    expect(currentStartingTheme().name).toBe('light');
  });

  it('puts the stored theme on <html> with its variables', () => {
    localStorage.setItem('shell:theme', JSON.stringify('dark'));
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--mf-color-bg')).not.toBe('');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem('shell:theme', '{broken');
    expect(currentStartingTheme().name).toBe('light');
    localStorage.setItem('shell:theme', JSON.stringify('purple'));
    expect(currentStartingTheme().name).toBe('light');
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'ignores a stored name that only exists on every object: %s',
    (name) => {
      localStorage.setItem('shell:theme', JSON.stringify(name));
      expect(currentStartingTheme().name).toBe('light');
      applyStoredTheme();
      expect(document.documentElement.dataset.theme).toBe('light');
    },
  );
});
