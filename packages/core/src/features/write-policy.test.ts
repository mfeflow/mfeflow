import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import {
  assertThirdPartyPath,
  assertWritable,
  isProtectedPath,
  isTestFilePath,
  policyKey,
} from './write-policy';

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
    for (const file of ['.git\u200b/hooks/x', 'src/a\u0000.ts', 'src/\u202ets.a', 'src/a\n.ts']) {
      expect(code(file), file).toBe('MFEFLOW_E105');
    }
  });

  it('lets ordinary files through for a first-party feature', () => {
    for (const file of ['src/a.ts', '.github/workflows/ci.yml', 'package.json', '.env.example']) {
      expect(() => assertWritable(file)).not.toThrow();
    }
  });
});

const thirdPartyCode = (relative: string, joined = relative) =>
  thrown(() => assertThirdPartyPath(relative, joined)).code;

describe('isTestFilePath', () => {
  it('matches the names and folders a test runner collects, in any case', () => {
    for (const file of [
      'src/test.js',
      'src/spec.js',
      'src/Test.JS',
      'src/a.test.ts',
      'src/a.SPEC.tsx',
      'src/a.test.d.ts',
      'src/a-test.js',
      'src/a_test.js',
      'src/a_spec.js',
      'src/a-spec.ts',
      'src/test-utils.ts',
      'src/test_helpers.ts',
      'src/spec-a.ts',
      'src/test/a.ts',
      'src/tests/deep/a.ts',
      'src/__tests__/a.ts',
      'src/Tests/a.ts',
      'src/spec/a.ts',
      'src/specs/a.ts',
      'src/a.bench.ts',
      'src/vitest.config.ts',
    ]) {
      expect(isTestFilePath(file), file).toBe(true);
    }
  });

  it('leaves ordinary names alone, including ones that merely contain the word', () => {
    for (const file of [
      'src/a.ts',
      'src/latest.ts',
      'src/contest.ts',
      'src/attestation.ts',
      'src/inspect.ts',
      'src/specimen.ts',
      'src/testing.ts',
      'src/test',
      'src/protest/a.ts',
      'docs/x.md',
    ]) {
      expect(isTestFilePath(file), file).toBe(false);
    }
  });
});

describe('assertThirdPartyPath', () => {
  it('allows source, public assets and docs, in any depth', () => {
    for (const file of ['src/a.ts', 'src/platform/consent.tsx', 'public/logo.svg', 'docs/x.md']) {
      expect(() => assertThirdPartyPath(file, `apps/shell/${file}`), file).not.toThrow();
    }
  });

  it('refuses root-level files and everything outside src, public and docs', () => {
    for (const file of [
      'README.md',
      'a.txt',
      '.pnpmfile.mjs',
      '.PNPMFILE.MJS',
      'rsbuild.config.ts',
      'index.html',
      'scripts/postinstall.js',
      'features/x/feature.json',
      'srcs/a.ts',
    ]) {
      expect(thirdPartyCode(file), file).toBe('MFEFLOW_E203');
    }
  });

  it('refuses dot folders and files even under src', () => {
    for (const file of ['src/.hidden', '.github/workflows/ci.yml', 'src/.husky/pre-commit']) {
      expect(thirdPartyCode(file), file).toBe('MFEFLOW_E203');
    }
  });

  it('refuses package manager config and hook managers under src too', () => {
    for (const file of [
      'src/package.json',
      'src/pnpm-workspace.yaml',
      'src/lefthook.yml',
      'src/yarn.lock',
      'docs/.npmrc',
    ]) {
      expect(thirdPartyCode(file), file).toBe('MFEFLOW_E203');
    }
  });

  it('refuses files test runners and tools pick up by name', () => {
    for (const file of [
      'src/a.test.ts',
      'src/a.SPEC.tsx',
      'src/__tests__/a.ts',
      'src/vitest.config.ts',
      'src/test.js',
      'src/a_test.js',
      'src/tests/a.ts',
    ]) {
      expect(thirdPartyCode(file), file).toBe('MFEFLOW_E203');
    }
  });

  it('refuses names outside a plain ASCII set, and 8.3 short names', () => {
    for (const file of [
      'src/café.ts',
      'src/a b.ts',
      'src/．git/x',
      'src/PNPMFI~1.mjs',
      'src/a$b.ts',
    ]) {
      expect(thirdPartyCode(file), file).toBe('MFEFLOW_E203');
    }
  });

  it('refuses the local features folder, wherever the target puts it', () => {
    expect(thirdPartyCode('docs/a.md', 'features/docs/a.md')).toBe('MFEFLOW_E203');
    expect(thirdPartyCode('docs/a.md', 'Features/docs/a.md')).toBe('MFEFLOW_E203');
  });

  it('applies the universal rules first', () => {
    expect(thirdPartyCode('src/aux.ts')).toBe('MFEFLOW_E105');
  });
});
