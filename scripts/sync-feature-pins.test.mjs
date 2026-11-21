import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpPatch, driftIn, main, readCatalog, rewrite } from './sync-feature-pins.mjs';

const YAML = `packages:
  - packages/*
catalog:
  '@rsbuild/core': 2.3.2
  vite: 8.3.8
  # a comment
  "quoted": 1.0.0
overrides:
  vite: 1.0.0
`;

describe('readCatalog', () => {
  it('reads plain and quoted names and stops at the next top-level key', () => {
    const catalog = readCatalog(YAML);
    expect(Object.fromEntries(catalog)).toEqual({
      '@rsbuild/core': '2.3.2',
      vite: '8.3.8',
      quoted: '1.0.0',
    });
  });
});

describe('driftIn', () => {
  const catalog = new Map([
    ['@rsbuild/core', '2.3.2'],
    ['vite', '8.3.8'],
  ]);

  it('finds exact pins that differ, at any depth', () => {
    const manifest = {
      version: '0.1.0',
      packages: [
        { name: '@rsbuild/core', range: '2.3.0' },
        { nested: [{ name: 'vite', range: '8.3.8' }] },
      ],
    };
    expect(driftIn(manifest, catalog)).toEqual([
      { name: '@rsbuild/core', from: '2.3.0', to: '2.3.2' },
    ]);
  });

  it('leaves ranges, workspace specs and names outside the catalog alone', () => {
    const manifest = [
      { name: 'vite', range: '^8.0.0' },
      { name: 'vite', range: 'workspace:*' },
      { name: 'react', range: '19.0.0' },
    ];
    expect(driftIn(manifest, catalog)).toEqual([]);
  });
});

describe('rewrite', () => {
  it('replaces each drifted pin, bumps the version once and keeps the formatting', () => {
    const text = `{
  "name": "core",
  "version": "0.6.2",
  "packages": [
    {
      "name": "@rsbuild/core",
      "range": "2.3.0",
      "target": "shell"
    },
    {
      "name": "@rsbuild/core",
      "range": "2.3.0",
      "target": "remotes"
    }
  ]
}
`;
    const out = rewrite(text, [{ name: '@rsbuild/core', from: '2.3.0', to: '2.3.2' }]);
    expect(out).toBe(text.replaceAll('"2.3.0"', '"2.3.2"').replace('"0.6.2"', '"0.6.3"'));
  });

  it('refuses a version it cannot bump', () => {
    expect(() => bumpPatch('1.0.0-rc.1')).toThrow(/not a plain/);
    expect(bumpPatch('0.6.9')).toBe('0.6.10');
  });
});

describe('main', () => {
  let dir;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function repo() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), YAML);
    fs.mkdirSync(path.join(dir, 'features', 'x'), { recursive: true });
    const file = path.join(dir, 'features', 'x', 'feature.json');
    fs.writeFileSync(
      file,
      `${JSON.stringify({ name: 'x', version: '0.2.0', packages: [{ name: 'vite', range: '8.3.5' }] }, null, 2)}\n`,
    );
    return file;
  }
  const quiet = { log: () => {}, error: () => {} };

  it('--check reports drift, exits 1 and writes nothing', () => {
    const file = repo();
    const before = fs.readFileSync(file, 'utf8');
    expect(main(['--check'], dir, quiet)).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('rewrites the pins, then --check passes', () => {
    const file = repo();
    expect(main([], dir, quiet)).toBe(0);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.version).toBe('0.2.1');
    expect(after.packages[0].range).toBe('8.3.8');
    expect(main(['--check'], dir, quiet)).toBe(0);
  });
});
