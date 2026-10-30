import { describe, expect, it } from 'vitest';
import { helpText, main, versionText } from './index.js';
import { readPackageJson } from './version.js';

describe('mfeflow cli', () => {
  it('prints the package version', () => {
    expect(versionText()).toBe(`mfeflow ${readPackageJson().version}`);
  });

  it('prints help with no arguments', () => {
    const out: string[] = [];
    expect(main([], (t) => out.push(t))).toBe(0);
    expect(out.join('')).toBe(helpText());
  });

  it('prints the version for --version and -v', () => {
    for (const flag of ['--version', '-v']) {
      const out: string[] = [];
      expect(main([flag], (t) => out.push(t))).toBe(0);
      expect(out.join('')).toBe(versionText());
    }
  });

  it('fails on unknown commands', () => {
    const out: string[] = [];
    expect(main(['deploy'], (t) => out.push(t))).toBe(1);
    expect(out.join('')).toContain('Unknown command: deploy');
  });
});
