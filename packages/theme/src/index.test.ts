import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  cssVar,
  cssVarName,
  defineTheme,
  noFlashScript,
  resolveTheme,
  themeToCssVars,
} from './index.js';

const light = defineTheme('light', { 'color-bg': '#fff', 'color-fg': '#111', radius: '8px' });
const dark = defineTheme(
  'dark',
  { 'color-bg': '#000', 'color-fg': '#eee' },
  { colorScheme: 'dark' },
);

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('tokens', () => {
  it('maps tokens to --mf- variables', () => {
    expect(cssVarName('color-bg')).toBe('--mf-color-bg');
    expect(cssVar('color-bg')).toBe('var(--mf-color-bg)');
    expect(cssVar('color-bg', 'white')).toBe('var(--mf-color-bg, white)');
    expect(themeToCssVars(dark)).toEqual({ '--mf-color-bg': '#000', '--mf-color-fg': '#eee' });
  });

  it('rejects bad token and theme names', () => {
    expect(() => cssVarName('Color')).toThrow(/Invalid token/);
    expect(() => defineTheme('x', { 'bad token': '1' })).toThrow(/Invalid token/);
    expect(() => defineTheme('My Theme', {})).toThrow(/Invalid theme name/);
  });

  it('freezes themes', () => {
    expect(Object.isFrozen(light)).toBe(true);
    expect(Object.isFrozen(light.tokens)).toBe(true);
    expect(light.colorScheme).toBe('light');
  });
});

describe('applyTheme', () => {
  it('writes variables, data-theme and color-scheme, and drops stale variables', () => {
    const root = document.documentElement;
    applyTheme(light);
    expect(root.style.getPropertyValue('--mf-radius')).toBe('8px');
    expect(root.dataset.theme).toBe('light');
    applyTheme(dark);
    expect(root.style.getPropertyValue('--mf-color-bg')).toBe('#000');
    expect(root.style.getPropertyValue('--mf-radius')).toBe('');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('prefers stored, then system dark, then default', () => {
    expect(resolveTheme([light, dark], 'dark', 'light').name).toBe('dark');
    expect(resolveTheme([light, dark], 'gone', 'light').name).toBe('light');
    expect(resolveTheme([light, dark], undefined, 'light', true).name).toBe('dark');
    expect(resolveTheme([light], undefined, 'light', true).name).toBe('light');
  });

  it('throws when the default is unknown', () => {
    expect(() => resolveTheme([light], undefined, 'nope')).toThrow(/Default theme "nope"/);
  });
});

function runScript(src: string): void {
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call -- runs the generated inline script exactly as the shell ships it
  new Function(src)();
}

describe('noFlashScript', () => {
  it('applies the stored theme before React runs', () => {
    localStorage.setItem('shell:theme', '"dark"');
    runScript(noFlashScript([light, dark], { defaultTheme: 'light' }));
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--mf-color-bg')).toBe('#000');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('falls back to the system preference, then the default', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('dark'), media: query }),
    });
    try {
      runScript(noFlashScript([light, dark], { defaultTheme: 'light' }));
      expect(document.documentElement.dataset.theme).toBe('dark');
      runScript(noFlashScript([light, dark], { defaultTheme: 'light', followSystem: false }));
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('ignores corrupt storage and never throws', () => {
    localStorage.setItem('shell:theme', '{oops');
    expect(() => {
      runScript(noFlashScript([light, dark], { defaultTheme: 'light', followSystem: false }));
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('escapes < so token values cannot close the script tag', () => {
    const evil = defineTheme('evil', { x: '</script><script>alert(1)</script>' });
    expect(noFlashScript([evil], { defaultTheme: 'evil' })).not.toContain('</script>');
  });

  it('rejects an unknown default theme', () => {
    expect(() => noFlashScript([light], { defaultTheme: 'nope' })).toThrow();
  });
});
