import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './testing';

const BARE = /pnpm (doctor|validate|check-compat|budget)(?![-\w:])/;
/** A line that names the pitfall on purpose, as in "not `pnpm doctor`". */
const WARNING = /\bnot\s+[`'"]?pnpm (doctor|validate|check-compat|budget)\b/i;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '__snapshots__']);

const isBare = (line: string) => BARE.test(line) && !WARNING.test(line);

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) return [full];
    return SKIPPED_DIRS.has(entry.name) ? [] : filesUnder(full);
  });
}

const isCliSource = (file: string) => file.endsWith('.ts') && !file.endsWith('.test.ts');

function offendersIn(root: string, keep: (file: string) => boolean = () => true): string[] {
  return filesUnder(path.join(REPO, root))
    .filter(keep)
    .filter((file) => fs.readFileSync(file, 'utf8').split('\n').some(isBare))
    .map((file) => path.relative(REPO, file));
}

describe('commands written into generated files and shown to users', () => {
  it('never says `pnpm doctor` in templates or features (use `pnpm run doctor`)', () => {
    expect([...offendersIn('templates'), ...offendersIn('features')]).toEqual([]);
  });

  it('never says `pnpm doctor` in the CLI messages', () => {
    expect(offendersIn('packages/cli/src', isCliSource)).toEqual([]);
  });

  it('never says `pnpm doctor` in the docs', () => {
    expect(offendersIn('apps/docs/docs')).toEqual([]);
  });

  it('keeps the pattern honest', () => {
    expect(isBare('pnpm doctor')).toBe(true);
    expect(isBare('pnpm budget # x')).toBe(true);
    expect(isBare('run `pnpm validate` now')).toBe(true);
    expect(isBare('pnpm run doctor')).toBe(false);
    expect(isBare('pnpm mfeflow doctor')).toBe(false);
    expect(isBare('pnpm doctor-extra')).toBe(false);
  });

  it('allows a line that names the pitfall', () => {
    expect(isBare('Use `pnpm run doctor`, not `pnpm doctor`.')).toBe(false);
    expect(isBare('pnpm doctor is pnpm built-in, not pnpm doctor from mfeflow')).toBe(false);
    expect(isBare('Run pnpm doctor, not much else')).toBe(true);
  });
});
