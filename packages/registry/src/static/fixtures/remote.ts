import { randomBytes } from 'node:crypto';
import type { MfeManifest, RegistryIndex } from '@mfeflow/contracts';
import type { PlanInput } from '../plan';

export const BASE_URL = 'https://cdn.example.com';

export function mfe(name = 'cart', routes: string[] = ['/cart']): MfeManifest {
  return {
    name,
    owner: 'team-cart',
    shells: ['shell'],
    routes,
    exposes: ['./App'],
    budgets: { initialJsKb: 8 },
  };
}

export function manifestFor(name = 'cart', react = '^19.0.0'): unknown {
  return {
    name,
    metaData: {
      name,
      globalName: name,
      publicPath: 'auto',
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'global' },
    },
    exposes: [{ path: './App', assets: { js: { sync: ['static/js/App.js'] }, css: { sync: [] } } }],
    shared: [
      { name: 'react', version: '19.0.0', singleton: true, requiredVersion: react },
      { name: 'lodash', version: '4.0.0', singleton: false, requiredVersion: '^4.0.0' },
    ],
  };
}

export function filesFor(
  manifest: unknown,
  entryBytes = 2048,
  appBytes = 1024,
): Record<string, Uint8Array> {
  return {
    'mf-manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'remoteEntry.js': randomBytes(entryBytes),
    'static/js/App.js': randomBytes(appBytes),
  };
}

export function shellManifest(react = '19.1.0'): unknown {
  return { name: 'shell', shared: [{ name: 'react', version: react, singleton: true }] };
}

export function input(overrides: Partial<PlanInput> = {}): PlanInput {
  const remote = overrides.remote ?? mfe();
  const manifest = overrides.manifest ?? manifestFor(remote.name);
  return {
    remote,
    version: '1.0.0',
    manifest,
    files: filesFor(manifest),
    env: 'prod',
    baseUrl: BASE_URL,
    shellManifest: shellManifest(),
    generatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

export const indexWith = (...remotes: RegistryIndex['remotes']): RegistryIndex => ({
  env: 'prod',
  remotes,
});
