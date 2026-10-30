import { describe, expect, it } from 'vitest';
import { main, notReadyText } from './index.js';
import { readPackageJson } from './version.js';

describe('create-mfeflow', () => {
  it('says it is not ready and exits 1', () => {
    const out: string[] = [];
    expect(main((t) => out.push(t))).toBe(1);
    expect(out.join('')).toBe(notReadyText());
    expect(notReadyText()).toContain(readPackageJson().version);
  });
});
