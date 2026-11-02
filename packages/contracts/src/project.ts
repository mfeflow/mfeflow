import { Checker, isObj, isSafeRelativePath, isUrl, type Issue } from './validate';
import { MFE_NAME } from './mfe-manifest';
import { isRegistryProtocol, registryTemplateProblem } from './feature-registry';

/** `mfeflow.json`: the CLI's record of a project. */
export interface MfeflowProject {
  $schema?: string;
  version: 1;
  /** Version of the CLI that last wrote this file. */
  cli?: string;
  /** Which repo this is in a multi-repo setup. Absent means a monorepo. A `platform` or `remote` repo may have no shell. */
  repo?: 'platform' | 'shell' | 'remote';
  topology: 'monorepo' | 'polyrepo' | 'hybrid';
  packageManager: 'pnpm' | 'npm';
  /** npm scope for the project's own packages, e.g. `@shopco`. */
  scope: string;
  apps: Record<string, { kind: 'shell' | 'remote'; path: string; port?: number }>;
  features: Record<
    string,
    {
      version: string;
      options?: Record<string, unknown>;
      /** `sha256-<hex>` of the `feature.json` a registry served when the feature was added. Third-party features only. */
      integrity?: string;
    }
  >;
  /** Hashes of copied files, so `upgrade` can tell when a file was edited. */
  files?: Record<string, string>;
  /**
   * Files `upgrade --keep` left alone: the hash of the new version each one was kept against.
   * While the new version is that one, the file stays quiet; when it changes, the file is raised again.
   */
  kept?: Record<string, string>;
  /**
   * Keys `mfeflow add env-key` wrote, by the file it wrote them in. `upgrade` asks before a new
   * template changes the value of one of them. Absent in projects made before this was recorded.
   */
  envKeys?: Record<string, string[]>;
  /** Third-party feature registries: `{ "@someone": "https://…/{name}.json" }`, https only (plain http for loopback hosts). `@mfeflow` is reserved. */
  registries?: Record<string, string>;
  /** Built mfeflow checkout, relative to the project root, that `@mfeflow/*` dependencies link to. Set by `--local` only. */
  local?: string;
  /** Overrides of the cost-model budget `mfeflow budget` and the perf job check. */
  budget?: ProjectBudget;
  /** Where `mfeflow deploy`, `promote`, `rollback` and `status` publish by default. */
  registry?: ProjectRegistry;
}

export interface ProjectRegistry {
  /** `file:<dir>` for a folder, or `s3://<bucket>[/prefix]`. Credentials never go here; they come from the environment. */
  host?: string;
  /** Where the host's files are served from (`https://cdn.example.com`), without a trailing slash. */
  baseUrl?: string;
}

export interface ProjectBudget {
  /** JS the shell may add over a one-app build, in KB. Default 32. */
  shellKb?: number;
  /** JS each remote on a route may add, in KB. Default 10. */
  remoteKb?: number;
  /** LCP the shell may add, in ms. Measured by the perf job, not by `mfeflow budget`. Default 300. */
  lcpDeltaMs?: number;
  /** Initial JS of your pages built as one app, in KB. Turns on the shell check in `mfeflow budget`. */
  baselineKb?: number;
}

const SEGMENT = String.raw`(?!\.\.?(?:/|$))[^/\\\u0000]+`;

/** The regex form of `isCheckoutPath`, for JSON Schema. */
export const CHECKOUT_PATH = new RegExp(
  `^(?:(?![A-Za-z]:)(?:\\.\\.(?:/\\.\\.)*(?:/${SEGMENT})*|${SEGMENT}(?:/${SEGMENT})*)|(?:/|[A-Za-z]:/)${SEGMENT}(?:/${SEGMENT})*)$`,
);

/** An env key name, as `mfeflow add env-key` accepts it. */
export const ENV_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const FILE_HASH = /^sha256-[0-9a-f]{64}$/;
export const REGISTRY_NAMESPACE = /^@[a-z0-9][a-z0-9-]*$/;

/** A relative path with forward slashes whose only `..` segments come first, so it may leave the project. */
export function isCheckoutPath(value: string): boolean {
  if (value === '' || value.includes('\\') || value.includes('\0')) return false;
  const absolute = /^(?:\/|[A-Za-z]:\/)/.exec(value);
  if (absolute) {
    const parts = value.slice(absolute[0].length).split('/');
    return parts.every((part) => part !== '' && part !== '.' && part !== '..');
  }
  if (/^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  const climbing = parts.findIndex((part) => part !== '..');
  const rest = climbing === -1 ? [] : parts.slice(climbing);
  return rest.every((part) => part !== '' && part !== '.' && part !== '..');
}

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** `file:<dir>` or `s3://<bucket>[/prefix]`. No credentials: `@` and `:` cannot appear in a bucket name. */
export const REGISTRY_HOST = /^(?:file:\S.*|s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](?:\/\S*)?)$/;

export const SCOPE = /^@[a-z0-9][a-z0-9-._]*$/;
export const PROJECT_REPOS = ['platform', 'shell', 'remote'] as const;
const FEATURE = /^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*$/;

export function validateMfeflowProject(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  if (value.version !== 1) c.add('version', 'must be 1');
  if ('cli' in value) {
    c.string(value, 'cli', '', {
      required: false,
      pattern: SEMVER,
      hint: 'must be a version like "0.5.0"',
    });
  }
  let repo: string | undefined;
  if ('repo' in value) {
    repo = c.string(value, 'repo', '', { required: false });
    if (repo !== undefined && !PROJECT_REPOS.some((name) => name === repo)) {
      c.add('repo', 'must be platform, shell or remote');
    }
  }
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
      const port = c.number(app, 'port', at, { required: false, min: 1, max: 65535 });
      if (port !== undefined && !Number.isInteger(port))
        c.add(`${at}.port`, 'must be a whole number');
    }
    if (shells === 0 && repo !== 'remote' && repo !== 'platform') {
      c.add('apps', 'needs at least one shell');
    }
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
        if ('integrity' in feature) {
          const integrity = c.string(feature, 'integrity', at);
          if (integrity !== undefined && !FILE_HASH.test(integrity))
            c.add(`${at}.integrity`, 'must be a hash like "sha256-<64 hex characters>"');
        }
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
  const kept = c.object(value, 'kept', '', false);
  if (kept) {
    for (const [file, hash] of Object.entries(kept)) {
      const at = `kept.${file}`;
      if (!isSafeRelativePath(file)) c.add(at, 'must be a relative path with forward slashes');
      if (typeof hash !== 'string' || !FILE_HASH.test(hash))
        c.add(at, 'must be a hash like "sha256-<64 hex characters>"');
    }
  }
  const envKeys = c.object(value, 'envKeys', '', false);
  if (envKeys) {
    for (const [file, keys] of Object.entries(envKeys)) {
      const at = `envKeys.${file}`;
      if (!isSafeRelativePath(file)) c.add(at, 'must be a relative path with forward slashes');
      if (
        !Array.isArray(keys) ||
        keys.some((key) => typeof key !== 'string' || !ENV_KEY_NAME.test(key))
      )
        c.add(at, 'must be a list of key names like "API_ORIGIN"');
    }
  }
  const registries = c.object(value, 'registries', '', false);
  if (registries) {
    for (const [ns, url] of Object.entries(registries)) {
      const at = `registries.${ns}`;
      if (ns === '@mfeflow') c.add(at, '@mfeflow is reserved for first-party features');
      else if (!REGISTRY_NAMESPACE.test(ns)) c.add(at, 'namespaces look like "@someone"');
      if (typeof url !== 'string')
        c.add(at, 'must be a URL template like "https://example.com/{name}.json"');
      else {
        const problem = registryTemplateProblem(url);
        if (problem !== undefined) c.add(at, problem);
      }
    }
  }
  if ('local' in value) {
    const local = c.string(value, 'local', '');
    if (local !== undefined && !isCheckoutPath(local)) {
      c.add(
        'local',
        'must be a path with forward slashes: relative like "../mfeflow", or absolute when no relative path exists',
      );
    }
  }
  const budget = c.object(value, 'budget', '', false);
  if (budget) {
    for (const key of ['shellKb', 'remoteKb', 'lcpDeltaMs', 'baselineKb']) {
      c.number(budget, key, 'budget', { required: false, min: 1 });
    }
  }
  const registry = c.object(value, 'registry', '', false);
  if (registry) {
    c.string(registry, 'host', 'registry', {
      required: false,
      pattern: REGISTRY_HOST,
      hint: 'must be file:<dir> or s3://<bucket>[/prefix], with no credentials',
    });
    const baseUrl = c.string(registry, 'baseUrl', 'registry', { required: false });
    if (baseUrl !== undefined && !(isUrl(baseUrl) && validBaseUrl(baseUrl))) {
      c.add(
        'registry.baseUrl',
        'must be an https URL (http only on localhost) without credentials, a query, a fragment or a trailing slash',
      );
    }
  }
  return c.issues;
}

function validBaseUrl(value: string): boolean {
  const url = new URL(value);
  return (
    isRegistryProtocol(url) &&
    url.username === '' &&
    url.password === '' &&
    !/[?#]/.test(value) &&
    !value.endsWith('/')
  );
}

export function isMfeflowProject(value: unknown): value is MfeflowProject {
  return validateMfeflowProject(value).length === 0;
}
