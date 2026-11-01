import {
  isRemoteName,
  isRegistryIndexRemote,
  remoteFileIssues,
  registryRemoteIssues,
  ROUTE,
  type RegistryIndex,
  type RegistryIndexRemote,
} from './entry';
import { routesOverlap } from './routes';
import { Checker, isObj, isUrl, type Issue } from './validate';

export {
  isRegistryIndexRemote,
  registryRemoteIssues,
  type RegistryIndex,
  type RegistryIndexRemote,
};

/** `registry/envs/<env>/<name>.json`: what one remote serves in one environment. */
export interface RegistryEntry {
  version: string;
  manifestUrl: string;
  /** The remote's entry script, read from `mf-manifest.json` at publish time. Production shells register this, not the manifest. */
  remoteEntry?: string;
  /** How `remoteEntry` loads (`module` for ESM). Needed by shells that register it directly. */
  type?: string;
  /** The global `remoteEntry` defines when it differs from the remote's name. */
  entryGlobalName?: string;
  /** Per expose (`./App`), the JS and CSS files it needs before it renders. The edge turns these into preload hints. */
  exposes?: Record<string, string[]>;
  previous?: string;
  owner?: string;
  rollout?: { candidate: string; stable: string; percent: number };
}

/** The `code` of the issues `validateRegistryIndex` reports for overlapping routes. */
export const ROUTE_OVERLAP = 'route-overlap';

export const VERSION = /^[0-9A-Za-z.+-]+$/;

function addIssues(c: Checker, issues: Issue[], at: string): void {
  for (const issue of issues) c.add([at, issue.path].filter(Boolean).join('.'), issue.message);
}

export function validateRegistryEntry(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  c.string(value, 'version', '', {
    pattern: VERSION,
    hint: 'must be a version like 1.4.2+a1b2c3d',
  });
  const url = c.string(value, 'manifestUrl', '');
  if (url !== undefined && !isUrl(url)) c.add('manifestUrl', 'must be an http(s) URL');
  addIssues(c, remoteFileIssues(value), '');
  c.string(value, 'previous', '', { required: false, pattern: VERSION, hint: 'must be a version' });
  c.string(value, 'owner', '', { required: false });
  const rollout = c.object(value, 'rollout', '', false);
  if (rollout) {
    c.string(rollout, 'candidate', 'rollout', { pattern: VERSION, hint: 'must be a version' });
    c.string(rollout, 'stable', 'rollout', { pattern: VERSION, hint: 'must be a version' });
    c.number(rollout, 'percent', 'rollout', { min: 0, max: 100 });
  }
  return c.issues;
}

export function validateRegistryIndex(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  for (const key of ['shell', 'env', 'generatedAt']) c.string(value, key, '', { required: false });
  const remotes = value.remotes;
  if (!Array.isArray(remotes)) {
    c.add('remotes', 'must be an array');
    return c.issues;
  }
  const names = new Set<string>();
  const claimed: { remote: string; route: string }[] = [];
  remotes.forEach((remote: unknown, i) => {
    const at = `remotes[${String(i)}]`;
    if (!isObj(remote)) {
      c.add(at, 'must be an object');
      return;
    }
    addIssues(c, registryRemoteIssues(remote), at);
    const { name } = remote;
    if (typeof name !== 'string' || !isRemoteName(name)) return;
    if (names.has(name)) c.add(`${at}.name`, `duplicate remote "${name}"`);
    names.add(name);
    const routes = Array.isArray(remote.routes)
      ? remote.routes.filter((r): r is string => typeof r === 'string' && ROUTE.test(r))
      : [];
    for (const route of routes) {
      for (const other of claimed) {
        if (other.remote !== name && routesOverlap(route, other.route))
          c.add(
            `${at}.routes`,
            `route "${route}" of "${name}" overlaps route "${other.route}" of "${other.remote}"`,
            ROUTE_OVERLAP,
          );
      }
    }
    for (const route of routes) claimed.push({ remote: name, route });
  });
  return c.issues;
}

export function isRegistryEntry(value: unknown): value is RegistryEntry {
  return validateRegistryEntry(value).length === 0;
}

export function isRegistryIndex(value: unknown): value is RegistryIndex {
  return validateRegistryIndex(value).length === 0;
}
