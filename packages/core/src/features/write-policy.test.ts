import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { assertWritable, isProtectedPath, policyKey } from './write-policy.js';

describe('policyKey', () => {
  it('folds case and Unicode composition so lookalike spellings meet the same rule', () => {
    expect(policyKey('Apps/Shell/.GIT/Config')).toBe('apps/shell/.git/config');
    expect(policyKey('café.ts')).toBe(policyKey('café.ts'));
    expect(policyKey('Keep')).toBe('keep');
  });
});

describe('isProtectedPath', () => {
  it('matches package manager and git hook files in any case, in any folder', () => {
    for (const file of [
      '.NPMRC',
      'apps/a/.pnpmfile.mjs',
      '.PnpmFile.CJS',
      'x/.yarnrc.yml',
      'pnpm-lock.yaml',
      'sub/package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'Package.JSON',
      'PNPM-Workspace.yaml',
      'Lefthook-local.yml',
      '.Husky/pre-commit',
      '.git',
      'x/.GIT/hooks/pre-commit',
      'node_modules/x/index.js',
    ]) {
      expect(isProtectedPath(file), file).toBe(true);
    }
    expect(isProtectedPath('src/index.ts')).toBe(false);
    expect(isProtectedPath('.github/workflows/ci.yml')).toBe(false);
  });
});

const code = (file: string) => thrown(() => assertWritable(file)).code;

describe('assertWritable for every feature', () => {
  it('refuses .git, node_modules and mfeflow.json in any case, as a folder or a file', () => {
    for (const file of [
      '.git',
      '.GIT/hooks/pre-commit',
      'apps/a/.Git',
      'node_modules/x/index.js',
      'apps/a/Node_Modules/x.js',
      'MFEFLOW.json',
      'mfeflow.json',
    ]) {
      expect(code(file), file).toBe('MFEFLOW_E105');
    }
  });

  it('refuses Windows tricks: trailing dots or spaces, streams, device names', () => {
    for (const file of [
      '.git./hooks/x',
      'src/a.ts.',
      'src/a.ts ',
      'node_modules /x',
      'src/a.ts:stream',
      'src/CON',
      'src/aux.tsx',
      'src/Com1.txt',
      'src/lpt9',
      'src/nul .txt',
    ]) {
      expect(code(file), file).toBe('MFEFLOW_E105');
    }
    expect(() => assertWritable('src/console.ts')).not.toThrow();
  });

  it('refuses control and invisible characters, which could hide a protected name', () => {
    for (const file of ['.git​/hooks/x', 'src/a\u0000.ts', 'src/‮ts.a', 'src/a\n.ts']) {
      expect(code(file), file).toBe('MFEFLOW_E105');
    }
  });

  it('lets ordinary files through for a first-party feature', () => {
    for (const file of ['src/a.ts', '.github/workflows/ci.yml', 'package.json', '.env.example']) {
      expect(() => assertWritable(file)).not.toThrow();
    }
  });
});
