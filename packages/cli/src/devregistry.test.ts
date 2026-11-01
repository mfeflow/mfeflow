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
});

const view = (apps: AppView[], registry: ProjectView['registry'] = {}): ProjectView => ({
  root: '/p',
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- devIndex reads only apps and registry
  project: {} as ProjectView['project'],
  apps,
  workspace: [],
  registry,
  envDirs: [],
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

describe('devIndex in a polyrepo shell', () => {
  const shellView = (devRemotes: Record<string, string>): ProjectView => ({
    ...view([]),
    devRemotes,
  });

  it('lists the remotes of the dev config, sorted, with the version dev', () => {
    const index = devIndex(
      shellView({
        search: 'http://localhost:4313/mf-manifest.json',
        cart: 'http://localhost:4312/mf-manifest.json',
      }),
    );
    expect(index.remotes).toEqual([
      { name: 'cart', entry: 'http://localhost:4312/mf-manifest.json', version: 'dev' },
      { name: 'search', entry: 'http://localhost:4313/mf-manifest.json', version: 'dev' },
    ]);
    expect(validateRegistryIndex(index)).toEqual([]);
  });

  it('lets --remote replace one of them', () => {
    const index = devIndex(
      shellView({ cart: 'http://localhost:4312/mf-manifest.json' }),
      new Map([['cart', 'http://localhost:3001/mf-manifest.json']]),
    );
    expect(index.remotes).toEqual([
      { name: 'cart', entry: 'http://localhost:3001/mf-manifest.json', version: 'override' },
    ]);
  });

  it('prefers an app of this project over a config entry of the same name', () => {
    const index = devIndex({
      ...view([remote('cart', 4301)]),
      devRemotes: {
        cart: 'http://localhost:9999/mf-manifest.json',
        search: 'http://localhost:4313/x',
      },
    });
    expect(index.remotes.map((r) => [r.name, r.entry])).toEqual([
      ['cart', 'http://localhost:4301/mf-manifest.json'],
      ['search', 'http://localhost:4313/x'],
    ]);
  });
});
