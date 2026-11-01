import { describe, expect, it } from 'vitest';
import { validateMfeflowProject } from '@mfeflow/contracts';
import { planAdoption } from './plan';
import type { DetectedApp, FederationReport } from './types';

function app(overrides: Partial<DetectedApp> = {}): DetectedApp {
  return {
    dir: '.',
    name: 'shell',
    role: 'shell',
    buildTool: 'rsbuild',
    configFile: 'rsbuild.config.ts',
    remotes: {},
    exposes: {},
    shared: {},
    ...overrides,
  };
}

const plan = (apps: DetectedApp[], notAdopted: FederationReport['notAdopted'] = []) =>
  planAdoption({ report: { apps, notAdopted }, scope: '@acme', packageManager: 'pnpm' });

function unnamed(detected: DetectedApp): DetectedApp {
  const { name: _name, ...rest } = detected;
  return rest;
}

const remote = (name: string, extra: Partial<DetectedApp> = {}) =>
  app({ dir: `apps/${name}`, name, role: 'remote', ...extra });

describe('planAdoption', () => {
  it('builds a valid project from a shell and the remotes it loads', () => {
    const result = plan([
      app({
        dir: 'apps/shell',
        port: 3000,
        remotes: {
          cart: { name: 'cart', entry: 'http://localhost:3001/mf-manifest.json', type: 'manifest' },
        },
      }),
      remote('cart', {
        port: 3001,
        exposes: { './Cart': './src/Cart' },
        shared: { react: { requiredVersion: '^19.0.0', singleton: true }, lodash: {} },
      }),
    ]);
    expect(validateMfeflowProject(result.project)).toEqual([]);
    expect(result.project.apps).toEqual({
      shell: { kind: 'shell', path: 'apps/shell', port: 3000 },
      cart: { kind: 'remote', path: 'apps/cart', port: 3001 },
    });
    expect(result.remotes).toEqual([{ name: 'cart', port: 3001 }]);
    expect(result.shellDirs).toEqual(['apps/shell']);
    expect(result.appFiles.find((f) => f.name === 'cart')?.content).toMatchObject({
      owner: 'unassigned',
      shells: ['shell'],
      routes: [],
      exposes: ['./Cart'],
      platform: { react: '^19.0.0' },
    });
  });

  it('matches a remote to the shell by alias when the entry has no name', () => {
    const result = plan([
      app({
        remotes: { cart: { entry: 'http://localhost:3001/mf-manifest.json', type: 'manifest' } },
      }),
      remote('cart', { dir: 'cart' }),
    ]);
    expect(result.appFiles.find((f) => f.name === 'cart')?.content.shells).toEqual(['shell']);
    expect(result.remotes).toEqual([{ name: 'cart', port: 3001 }]);
  });

  it('takes a remote without a port from a free dev port and says so', () => {
    const result = plan([app({ port: 4311 }), remote('cart')]);
    expect(result.remotes).toEqual([{ name: 'cart', port: 4312 }]);
    expect(result.warnings.join('\n')).toContain('cart: no dev port found');
  });

  it('leaves out an app with no literal name, an unusable one or a repeat, each with a reason', () => {
    const result = plan([
      app(),
      unnamed(remote('a', { configFile: 'a.config.ts' })),
      remote('b', { name: 'my-app' }),
      remote('c', { name: 'root' }),
      remote('d', { name: 'shell' }),
      remote('e', { name: 'e' }),
      remote('f', { name: 'e' }),
    ]);
    expect(Object.keys(result.project.apps)).toEqual(['shell', 'e']);
    const reasons = result.notAdopted.map((n) => n.reason);
    expect(reasons).toEqual([
      expect.stringContaining('no literal name'),
      expect.stringContaining('"my-app" is not a name mfeflow accepts'),
      expect.stringContaining('"root" is a name mfeflow keeps'),
      expect.stringContaining('"shell" is a name mfeflow keeps'),
      expect.stringContaining('"e" is already used'),
    ]);
    expect(result.notAdopted.every((n) => n.field === 'name')).toBe(true);
  });

  it('lists an expose key that is not a ./Name path instead of writing it', () => {
    const result = plan([
      app(),
      remote('cart', { exposes: { '.': './src/index', './Cart': './src/Cart' } }),
    ]);
    expect(result.appFiles.find((f) => f.name === 'cart')?.content.exposes).toEqual(['./Cart']);
    expect(result.notAdopted).toEqual([
      expect.objectContaining({ field: "exposes['.']", dir: 'apps/cart' }),
    ]);
  });

  it('keeps what the detector could not read, ahead of its own entries', () => {
    const skipped = { dir: '.', file: 'rsbuild.config.ts', field: 'port', reason: 'x' };
    expect(plan([app()], [skipped]).notAdopted[0]).toEqual(skipped);
  });

  it('warns about a remote loaded from outside the folder and about a remoteEntry.js', () => {
    const result = plan([
      app({
        remotes: {
          far: {
            name: 'far',
            entry: 'https://cdn.example.com/far/mf-manifest.json',
            type: 'manifest',
          },
          cart: { name: 'cart', entry: 'http://localhost:3001/remoteEntry.js', type: 'script' },
        },
      }),
      remote('cart', { port: 3001 }),
    ]);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('far: loaded by a shell but not found in this folder');
    expect(warnings).toContain('cart: loaded from a remoteEntry.js');
    expect(result.remotes.map((r) => r.name)).toEqual(['cart']);
  });

  it('stops with E124 when there is no shell, or nothing at all', () => {
    expect(() => plan([remote('cart')])).toThrow(/E124|only remotes were found \(cart\)/);
    expect(() => plan([])).toThrow(/no Module Federation config was found/);
    expect(() => plan([unnamed(app())])).toThrow(/no app had a usable name/);
  });
});
