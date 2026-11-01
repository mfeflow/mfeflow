import type { RegistryIndex, RegistryIndexRemote } from '@mfeflow/contracts';
import { MfeflowError } from '@mfeflow/core';
import type { ProjectView } from './inspect';

export type DevRemote = RegistryIndexRemote & { version: string };

export interface DevIndex extends RegistryIndex {
  remotes: DevRemote[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `name=url` flags as a map. A bare origin means its `/mf-manifest.json`. */
export function parseOverrides(
  flags: readonly string[],
  remotes: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const flag of flags) {
    const equals = flag.indexOf('=');
    if (equals < 1) throw new MfeflowError('E107', `--remote "${flag}" must look like name=url`);
    const name = flag.slice(0, equals);
    const raw = flag.slice(equals + 1);
    if (!remotes.includes(name)) {
      throw new MfeflowError(
        'E107',
        `--remote ${name}: no remote called "${name}" (remotes: ${remotes.join(', ')})`,
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new MfeflowError('E107', `--remote ${name}=${raw}: not a URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new MfeflowError('E107', `--remote ${name}=${raw}: only http and https URLs`);
    }
    if (url.pathname === '/' && url.search === '' && url.hash === '') {
      url = new URL('/mf-manifest.json', url);
    }
    out.set(name, url.href);
  }
  return out;
}

/** Throws E107 for an override outside localhost that `--allow-origin` did not name. */
export function assertAllowed(
  overrides: ReadonlyMap<string, string>,
  allowed: readonly string[],
): void {
  const origins = new Set(allowed.map((o) => originOf(o)));
  for (const [name, href] of overrides) {
    const url = new URL(href);
    if (!LOCAL_HOSTS.has(url.hostname) && !origins.has(url.origin)) {
      throw new MfeflowError(
        'E107',
        `--remote ${name}=${href} is not on localhost; pass --allow-origin ${url.origin} to allow it`,
      );
    }
  }
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new MfeflowError(
      'E107',
      `--allow-origin "${value}" is not an origin like https://dev.example.com`,
    );
  }
}

/**
 * What the shell reads in dev: every remote of mfeflow.json, from registry/envs/dev when it has an
 * entry (else from the remote's own port), with `overrides` replacing the entry URL.
 */
export function devIndex(
  view: ProjectView,
  overrides: ReadonlyMap<string, string> = new Map(),
): DevIndex {
  const inRepos = Object.entries(view.devRemotes ?? {})
    .filter(([name]) => !view.apps.some((app) => app.name === name))
    .map(([name, manifestUrl]): DevRemote => {
      const override = overrides.get(name);
      return {
        name,
        entry: override ?? manifestUrl,
        version: override === undefined ? 'dev' : 'override',
      };
    });
  const remotes = view.apps
    .filter((app) => app.kind === 'remote')
    .map((app): DevRemote => {
      const entry = view.registry.dev?.[app.name];
      const fromRegistry = entry?.state === 'ok' ? entry.value : undefined;
      const fallback =
        app.port === undefined ? '' : `http://localhost:${String(app.port)}/mf-manifest.json`;
      return {
        name: app.name,
        entry: overrides.get(app.name) ?? fromRegistry?.manifestUrl ?? fallback,
        version: overrides.has(app.name) ? 'override' : (fromRegistry?.version ?? 'dev'),
      };
    })
    .concat(inRepos)
    .filter((remote) => remote.entry !== '')
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { remotes };
}

export const serializeIndex = (index: DevIndex): string => `${JSON.stringify(index, null, 2)}\n`;
