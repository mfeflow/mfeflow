import { isRegistryIndexRemote, validateRegistryIndex } from '@mfeflow/contracts';
import { describe, expect, it } from 'vitest';
import { devIndex } from './devregistry';
import type { AppView, ProjectView } from './inspect';

const remote = (name: string, port: number): AppView => ({
  name,
  kind: 'remote',
  rel: `apps/${name}`,
  dir: `/p/apps/${name}`,
  port,
  present: true,
  pkg: undefined,
  mfe: { state: 'missing' },
  appFile: `apps/${name}/mfeflow.app.json`,
});

const view = (apps: AppView[], registry: ProjectView['registry'] = {}): ProjectView => ({
  root: '/p',
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- devIndex reads only apps and registry
  project: {} as ProjectView['project'],
  apps,
  workspace: [],
  registry,
  envDirs: [],
  legacyAppFiles: [],
});

describe('devIndex', () => {
  it('writes remotes the shared registry validator accepts, with names like order_status', () => {
    const index = devIndex(view([remote('order_status', 4302), remote('cart', 4301)]));
    expect(index.remotes.map((r) => r.name)).toEqual(['cart', 'order_status']);
    expect(validateRegistryIndex(index)).toEqual([]);
    for (const r of index.remotes) expect(isRegistryIndexRemote(r)).toBe(true);
  });

  it('keeps an override and a registry entry valid too', () => {
    const entry = {
      state: 'ok' as const,
      value: { version: '1.0.0', manifestUrl: 'https://cdn.example.com/cart/mf-manifest.json' },
    };
    const index = devIndex(
      view([remote('cart', 4301), remote('catalog', 4302)], { dev: { cart: entry } }),
      new Map([['catalog', 'http://localhost:9000/mf-manifest.json']]),
    );
    expect(index.remotes.map((r) => [r.name, r.version])).toEqual([
      ['cart', '1.0.0'],
      ['catalog', 'override'],
    ]);
    expect(validateRegistryIndex(index)).toEqual([]);
  });
});
