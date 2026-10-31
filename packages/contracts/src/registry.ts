import { Checker, isObj, isUrl, type Issue } from './validate.js';
import { MFE_NAME, ROUTE } from './mfe-manifest.js';

/** `registry/envs/<env>/<name>.json`: what one remote serves in one environment. */
export interface RegistryEntry {
  version: string;
  manifestUrl: string;
  previous?: string;
  owner?: string;
  rollout?: { candidate: string; stable: string; percent: number };
}

/** What the shell fetches at boot. */
export interface RegistryIndex {
  shell?: string;
  env?: string;
  generatedAt?: string;
  remotes: { name: string; entry: string; version?: string; routes?: string[]; owner?: string }[];
}

const VERSION = /^[0-9A-Za-z.+-]+$/;

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
  const claimed = new Map<string, string>();
  remotes.forEach((remote: unknown, i) => {
    const at = `remotes[${String(i)}]`;
    if (!isObj(remote)) {
      c.add(at, 'must be an object');
      return;
    }
    const name = c.string(remote, 'name', at, {
      pattern: MFE_NAME,
      hint: 'must be a Module Federation name',
    });
    const entry = c.string(remote, 'entry', at);
    if (entry !== undefined && !isUrl(entry)) c.add(`${at}.entry`, 'must be an http(s) URL');
    c.string(remote, 'version', at, { required: false });
    c.string(remote, 'owner', at, { required: false });
    const routes = c.stringArray(remote, 'routes', at, {
      required: false,
      pattern: ROUTE,
      hint: 'must start with "/"',
    });
    if (name !== undefined) {
      if (names.has(name)) c.add(`${at}.name`, `duplicate remote "${name}"`);
      names.add(name);
      for (const route of routes) {
        const owner = claimed.get(route);
        if (owner !== undefined && owner !== name)
          c.add(`${at}.routes`, `route "${route}" is already claimed by "${owner}"`);
        claimed.set(route, name);
      }
    }
  });
  return c.issues;
}

export function isRegistryEntry(value: unknown): value is RegistryEntry {
  return validateRegistryEntry(value).length === 0;
}

export function isRegistryIndex(value: unknown): value is RegistryIndex {
  return validateRegistryIndex(value).length === 0;
}
