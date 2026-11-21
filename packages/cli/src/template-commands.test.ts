import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './testing';

const BARE = /pnpm (doctor|validate|check-compat|budget)(?![-\w:])/;

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

describe('commands written into generated files', () => {
  it('never says `pnpm doctor`, which runs pnpm built-in doctor (use `pnpm run doctor`)', () => {
    const offenders = ['templates', 'features']
      .flatMap((root) => filesUnder(path.join(REPO, root)))
      .filter((file) => BARE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file));
    expect(offenders).toEqual([]);
  });

  it('keeps the pattern honest', () => {
    expect(BARE.test('pnpm doctor')).toBe(true);
    expect(BARE.test('pnpm budget # x')).toBe(true);
    expect(BARE.test('pnpm run doctor')).toBe(false);
    expect(BARE.test('pnpm mfeflow doctor')).toBe(false);
  });
});
