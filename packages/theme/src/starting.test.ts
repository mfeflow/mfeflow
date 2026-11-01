import { afterEach, describe, expect, it } from 'vitest';
import { defineTheme, noFlashScript } from '.';
import { startingTheme } from './starting';

const light = defineTheme('light', { 'color-bg': '#fff' });
const dark = defineTheme('dark', { 'color-bg': '#000' }, { colorScheme: 'dark' });
const themes = [light, dark];

function systemDark(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('dark'), media: query }),
  });
}

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'matchMedia');
  document.documentElement.removeAttribute('data-theme');
});

describe('startingTheme', () => {
  it('uses the stored choice, then the system preference, then the default', () => {
    expect(startingTheme(themes, { defaultTheme: 'light' }).name).toBe('light');
    localStorage.setItem('shell:theme', '"dark"');
    expect(startingTheme(themes, { defaultTheme: 'light' }).name).toBe('dark');
    localStorage.clear();
    systemDark();
    expect(startingTheme(themes, { defaultTheme: 'light' }).name).toBe('dark');
  });

  it('leaves the system preference out when followSystem is off', () => {
    systemDark();
    expect(startingTheme(themes, { defaultTheme: 'light', followSystem: false }).name).toBe(
      'light',
    );
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'purple', '{oops'])(
    'ignores a stored value that is not a theme: %s',
    (value) => {
      localStorage.setItem('shell:theme', value.startsWith('{') ? value : JSON.stringify(value));
      expect(startingTheme(themes, { defaultTheme: 'light', followSystem: false }).name).toBe(
        'light',
      );
    },
  );

  it('agrees with noFlashScript on every case', () => {
    const cases = [undefined, '"dark"', '"constructor"', '"purple"', '{oops'];
    for (const followSystem of [true, false]) {
      for (const systemDarkOn of [true, false]) {
        for (const stored of cases) {
          localStorage.clear();
          Reflect.deleteProperty(window, 'matchMedia');
          if (systemDarkOn) systemDark();
          if (stored !== undefined) localStorage.setItem('shell:theme', stored);
          document.documentElement.removeAttribute('data-theme');
          // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call -- runs the generated inline script as the shell ships it
          new Function(noFlashScript(themes, { defaultTheme: 'light', followSystem }))();
          const expected = startingTheme(themes, { defaultTheme: 'light', followSystem }).name;
          expect(
            document.documentElement.dataset.theme,
            JSON.stringify({ followSystem, systemDarkOn, stored }),
          ).toBe(expected);
        }
      }
    }
  });
});
