import path from 'node:path';
import {
  isSafeRelativePath,
  validateFeatureManifest,
  type FeatureManifest,
} from '@mfeflow/contracts';
import { FEATURE_NAME } from '@mfeflow/contracts';
import { MfeflowError, messageOf } from '../errors';
import { readIfExists, realFs, type FsOps } from '../fs';
import { fetchRemoteText, type FetchLike } from './remote';
import { assertAllowedKeys, assertKnownOps, assertThirdPartyContent, type Trust } from './policy';

export interface LoadedFeature {
  manifest: FeatureManifest;
  trust: Trust;
  /** Reads a `from` file of a local feature. Absent for remote features. */
  readAsset?: (relative: string) => Promise<string>;
  /** Folder of a local feature; migration modules are loaded from here. Absent for remote features. */
  dir?: string;
}

/** Parses and checks the text of a `feature.json`. Third-party manifests also pass the declarative-only policy. */
export function parseFeature(text: string, trust: Trust, label: string): FeatureManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MfeflowError('E202', `${label}: ${messageOf(error)}`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MfeflowError('E202', `${label}: must be a JSON object`);
  }
  const record = Object.fromEntries(Object.entries(value));
  if (trust === 'third-party') assertAllowedKeys(record, label);
  assertKnownOps(record, label);
  const issues = validateFeatureManifest(record);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path || '(root)'} ${i.message}`).join('; ');
    throw new MfeflowError('E202', `${label}: ${detail}`);
  }
  const manifest = toManifest(record, label);
  if (trust === 'third-party') assertThirdPartyContent(manifest, label);
  return manifest;
}

function toManifest(record: Record<string, unknown>, label: string): FeatureManifest {
  // validateFeatureManifest has accepted the shape; Object.assign copies it without a type assertion.
  const manifest: FeatureManifest = { name: '', version: '' };
  Object.assign(manifest, record);
  if (manifest.name === '') throw new MfeflowError('E202', `${label}: name is required`);
  return manifest;
}

export interface LoadOptions {
  /** Folder holding one sub-folder per first-party or local feature. */
  featuresDir?: string;
  /** From mfeflow.json `registries`. */
  registries?: Record<string, string>;
  fetch?: FetchLike;
  /** The version to ask a registry for, when its URL template has `{version}`. */
  version?: string;
  fs?: FsOps;
}

/**
 * Finds a feature by name. `@ns/name` comes from that namespace's registry and
 * is third-party; a plain name comes from the local `features/` folder and is
 * trusted. Trust follows where the bytes came from, never what the manifest says.
 */
export async function loadFeature(name: string, options: LoadOptions): Promise<LoadedFeature> {
  if (!FEATURE_NAME.test(name)) throw new MfeflowError('E201', `"${name}" is not a feature name`);
  if (name.startsWith('@')) return loadRemote(name, options);
  return loadLocal(name, options);
}

async function loadLocal(name: string, options: LoadOptions): Promise<LoadedFeature> {
  const ops = options.fs ?? realFs;
  if (!options.featuresDir)
    throw new MfeflowError('E201', `"${name}" (no features folder configured)`);
  const dir = path.join(options.featuresDir, name);
  const text = await readIfExists(ops, path.join(dir, 'feature.json'));
  if (text === undefined)
    throw new MfeflowError('E201', `"${name}" (looked in ${options.featuresDir})`);
  const manifest = parseFeature(text, 'first-party', `${name}/feature.json`);
  if (manifest.name !== name) {
    throw new MfeflowError(
      'E202',
      `${name}/feature.json: name is "${manifest.name}", expected "${name}"`,
    );
  }
  return {
    manifest,
    trust: 'first-party',
    dir,
    readAsset: async (relative) => {
      if (!isSafeRelativePath(relative)) throw new MfeflowError('E105', `"${relative}"`);
      const content = await readIfExists(ops, path.join(dir, ...relative.split('/')));
      if (content === undefined)
        throw new MfeflowError('E201', `${name}: file "${relative}" is missing`);
      return content;
    },
  };
}

async function loadRemote(name: string, options: LoadOptions): Promise<LoadedFeature> {
  const text = await fetchRemoteText(
    name,
    options.registries ?? {},
    options.fetch,
    options.version,
  );
  const manifest = parseFeature(text, 'third-party', name);
  if (manifest.name !== name) {
    throw new MfeflowError('E402', `asked for ${name}, got ${manifest.name}`);
  }
  return { manifest, trust: 'third-party' };
}

/** Names of the features in the local `features/` folder that have a feature.json. */
export async function listLocalFeatures(
  featuresDir: string,
  ops: FsOps = realFs,
): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = await ops.listDirs(featuresDir);
  } catch {
    return [];
  }
  const checked = await Promise.all(
    dirs.map(async (dir) =>
      (await readIfExists(ops, path.join(featuresDir, dir, 'feature.json'))) === undefined
        ? undefined
        : dir,
    ),
  );
  return checked.filter((d) => d !== undefined).toSorted((a, b) => a.localeCompare(b));
}
