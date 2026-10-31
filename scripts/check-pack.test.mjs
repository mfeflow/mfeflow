import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_TARBALL_BYTES,
  formatBytes,
  publicPackages,
  referencedFiles,
  validatePack,
} from './check-pack.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const rootLicense = fs.readFileSync(path.join(repo, 'LICENSE'), 'utf8');

const manifest = {
  name: '@mfeflow/example',
  version: '0.1.0',
  exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  dependencies: { semver: '^7.8.5' },
};
const goodFiles = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
const check = (overrides = {}) =>
  validatePack({
    manifest,
    files: goodFiles,
    tarballBytes: 1000,
    unpackedBytes: 2000,
    ...overrides,
  });

describe('public packages', () => {
  const packages = publicPackages(repo);

  it('finds the public packages and skips private ones', () => {
    const names = packages.map((p) => p.manifest.name);
    expect(names).toContain('mfeflow');
    expect(names).toContain('create-mfeflow');
    expect(
      names.every((n) => n === 'mfeflow' || n === 'create-mfeflow' || n.startsWith('@mfeflow/')),
    ).toBe(true);
    expect(packages.every((p) => p.manifest.private !== true)).toBe(true);
  });

  it.each(packages.map((p) => [p.manifest.name, p.dir]))(
    '%s ships the root LICENSE and a README',
    (_name, dir) => {
      expect(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8')).toBe(rootLicense);
      expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    },
  );

  it.each(packages.map((p) => [p.manifest.name, p.manifest]))(
    '%s does not exclude README or LICENSE through "files"',
    (_name, pkg) => {
      // npm always packs README, LICENSE and package.json; a negated pattern in "files" would still drop them.
      const negated = (pkg.files ?? []).filter((f) => f.startsWith('!'));
      expect(negated.filter((f) => /readme|license/i.test(f))).toEqual([]);
      expect(pkg.license).toBe('MIT');
    },
  );

  it('keeps every public package in the changesets fixed group', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repo, '.changeset/config.json'), 'utf8'));
    const grouped = new Set(config.fixed.flat());
    const missing = packages.map((p) => p.manifest.name).filter((n) => !grouped.has(n));
    expect(missing).toEqual([]);
    expect(config.ignore.filter((n) => grouped.has(n))).toEqual([]);
  });
});

describe('referencedFiles', () => {
  it('collects exports, bin and types, and skips wildcards', () => {
    expect(
      referencedFiles({
        exports: {
          '.': { types: './dist/a.d.ts', default: './dist/a.js' },
          './x/*': './dist/x/*.js',
          './c.json': './c.json',
        },
        bin: { tool: './bin/tool.js' },
        types: './dist/a.d.ts',
      }),
    ).toEqual(['dist/a.d.ts', 'dist/a.js', 'c.json', 'bin/tool.js']);
  });

  it('accepts a string bin', () => {
    expect(referencedFiles({ bin: './bin/x.js' })).toEqual(['bin/x.js']);
  });
});

describe('validatePack', () => {
  it('accepts a complete package', () => {
    expect(check()).toEqual([]);
  });

  it('reports a missing README and LICENSE', () => {
    expect(check({ files: ['package.json', 'dist/index.js', 'dist/index.d.ts'] })).toEqual([
      'README is missing',
      'LICENSE is missing',
    ]);
  });

  it('does not take a nested README for the package README', () => {
    expect(
      check({ files: [...goodFiles.filter((f) => f !== 'README.md'), 'dist/README.md'] }),
    ).toContain('README is missing');
  });

  it('reports an exports target missing from the tarball', () => {
    expect(check({ files: goodFiles.filter((f) => f !== 'dist/index.d.ts') })[0]).toMatch(
      /dist\/index\.d\.ts is referenced/,
    );
  });

  it.each([
    'src/index.ts',
    'dist/index.test.js',
    'dist/index.spec.d.ts',
    '__fixture__/a.json',
    '.turbo/log.txt',
    'coverage/lcov.info',
    'tsconfig.tsbuildinfo',
  ])('rejects %s', (file) => {
    expect(check({ files: [...goodFiles, file] }).some((p) => p.startsWith(`${file}:`))).toBe(true);
  });

  it.each(['workspace:*', 'catalog:', 'link:../x', 'file:../x'])('rejects the %s spec', (spec) => {
    const problems = check({ manifest: { ...manifest, peerDependencies: { x: spec } } });
    expect(problems).toEqual([`peerDependencies.x is still "${spec}"`]);
  });

  it('reports an oversize tarball with its size', () => {
    expect(check({ tarballBytes: MAX_TARBALL_BYTES + 1 })[0]).toMatch(/tarball is 5\.00 MB/);
  });

  describe('the mfeflow CLI', () => {
    const cli = { ...manifest, name: 'mfeflow' };
    const folders = [
      { kind: 'features', entries: ['tsconfig'] },
      { kind: 'templates', entries: ['monorepo'] },
    ];

    it('needs the features and templates in assets/', () => {
      expect(check({ manifest: cli, assetFolders: folders })).toEqual([
        'assets/features/ is empty or missing',
        'assets/templates/ is empty or missing',
      ]);
    });

    it('needs every feature folder, and allows the templates their own src/', () => {
      const files = [
        ...goodFiles,
        'assets/features/tsconfig/feature.json',
        'assets/templates/monorepo/files/shell/src/index.ts',
      ];
      expect(check({ manifest: cli, files, assetFolders: folders })).toEqual([]);
      expect(
        check({
          manifest: cli,
          files,
          assetFolders: [{ kind: 'features', entries: ['tsconfig', 'env-t3'] }, folders[1]],
        }),
      ).toEqual(['assets/features/env-t3/ is missing']);
    });

    it('does not ask other packages for assets', () => {
      expect(check({ assetFolders: folders })).toEqual([]);
    });
  });
});

describe('formatBytes', () => {
  it('uses KB below 1 MB and MB above', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
