import { Checker, isObj, isSafeRelativePath, type Issue } from './validate.js';
import { MFE_NAME } from './mfe-manifest.js';

/** `mfeflow.json`: the CLI's record of a project. */
export interface MfeflowProject {
  $schema?: string;
  version: 1;
  topology: 'monorepo' | 'polyrepo' | 'hybrid';
  packageManager: 'pnpm' | 'npm';
  /** npm scope for the project's own packages, e.g. `@shopco`. */
  scope: string;
  apps: Record<string, { kind: 'shell' | 'remote'; path: string }>;
  features: Record<string, { version: string; options?: Record<string, unknown> }>;
  /** Hashes of copied files, so `upgrade` can tell when a file was edited. */
  files?: Record<string, string>;
  /** Third-party feature registries: `{ "@someone": "https://…/{name}.json" }`. `@mfeflow` is reserved. */
  registries?: Record<string, string>;
}

export const FILE_HASH = /^sha256-[0-9a-f]{64}$/;
const REGISTRY_NAMESPACE = /^@[a-z0-9][a-z0-9-]*$/;

const SCOPE = /^@[a-z0-9][a-z0-9-._]*$/;
const FEATURE = /^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*$/;

export function validateMfeflowProject(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  if (value.version !== 1) c.add('version', 'must be 1');
  const topology = c.string(value, 'topology', '');
  if (topology !== undefined && !['monorepo', 'polyrepo', 'hybrid'].includes(topology)) {
    c.add('topology', 'must be monorepo, polyrepo or hybrid');
  }
  const pm = c.string(value, 'packageManager', '');
  if (pm !== undefined && !['pnpm', 'npm'].includes(pm))
    c.add('packageManager', 'must be pnpm or npm');
  c.string(value, 'scope', '', { pattern: SCOPE, hint: 'must be an npm scope like "@shopco"' });
  const apps = c.object(value, 'apps', '');
  let shells = 0;
  if (apps) {
    for (const [name, app] of Object.entries(apps)) {
      const at = `apps.${name}`;
      if (!MFE_NAME.test(name)) c.add(at, 'app names must be Module Federation names');
      if (!isObj(app)) {
        c.add(at, 'must be an object');
        continue;
      }
      const kind = c.string(app, 'kind', at);
      if (kind === 'shell') shells++;
      else if (kind !== undefined && kind !== 'remote')
        c.add(`${at}.kind`, 'must be shell or remote');
      c.string(app, 'path', at);
    }
    if (shells === 0) c.add('apps', 'needs at least one shell');
  }
  const features = c.object(value, 'features', '');
  if (features) {
    for (const [name, feature] of Object.entries(features)) {
      const at = `features.${name}`;
      if (!FEATURE.test(name))
        c.add(at, 'feature names look like "analytics-gtm" or "@someone/feature"');
      if (!isObj(feature)) c.add(at, 'must be an object');
      else {
        c.string(feature, 'version', at);
        c.object(feature, 'options', at, false);
      }
    }
  }
  const files = c.object(value, 'files', '', false);
  if (files) {
    for (const [file, hash] of Object.entries(files)) {
      const at = `files.${file}`;
      if (!isSafeRelativePath(file)) c.add(at, 'must be a relative path with forward slashes');
      if (typeof hash !== 'string' || !FILE_HASH.test(hash))
        c.add(at, 'must be a hash like "sha256-<64 hex characters>"');
    }
  }
  const registries = c.object(value, 'registries', '', false);
  if (registries) {
    for (const [ns, url] of Object.entries(registries)) {
      const at = `registries.${ns}`;
      if (ns === '@mfeflow') c.add(at, '@mfeflow is reserved for first-party features');
      else if (!REGISTRY_NAMESPACE.test(ns)) c.add(at, 'namespaces look like "@someone"');
      if (typeof url !== 'string' || !url.startsWith('https://') || !url.includes('{name}'))
        c.add(at, 'must be an https URL containing {name}');
    }
  }
  return c.issues;
}

export function isMfeflowProject(value: unknown): value is MfeflowProject {
  return validateMfeflowProject(value).length === 0;
}
