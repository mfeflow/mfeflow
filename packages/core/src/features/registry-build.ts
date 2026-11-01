import path from 'node:path';
import {
  SCHEMA_URLS,
  validateFeatureRegistryIndex,
  type FeatureRegistryIndex,
  type FeatureRegistryItem,
} from '@mfeflow/contracts';
import { valid } from 'semver';
import { isMfeflowError, MfeflowError, messageOf } from '../errors';
import { readIfExists, realFs, type FsOps } from '../fs';
import { parseFeature } from './load';
import { MAX_BYTES } from './remote';

export interface RegistryFile {
  /** Relative to the output folder, with forward slashes. */
  path: string;
  content: string;
}

export interface RegistryBuild {
  /** The namespace every feature in the folder uses, like `@test`. */
  namespace: string;
  index: FeatureRegistryIndex;
  features: { name: string; version: string; files: string[] }[];
  /** `index.json` and, per feature, `<name>.json`, `<name>/<version>.json` and `<name>/latest.json`. */
  files: RegistryFile[];
}

interface Found {
  folder: string;
  namespace: string;
  bare: string;
  version: string;
  description: string;
  keywords: string[] | undefined;
  json: string;
}

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Checks every `<dir>/<folder>/feature.json` the way `mfeflow add @namespace/name` will when a user
 * installs it, and returns the files to host: one registry folder serves any static host. Every
 * problem is collected, so an author fixes them in one pass. Writes nothing.
 */
export async function buildRegistry(dir: string, ops: FsOps = realFs): Promise<RegistryBuild> {
  let folders: string[];
  try {
    folders = (await ops.listDirs(dir)).toSorted((a, b) => a.localeCompare(b));
  } catch (error) {
    throw new MfeflowError('E404', `${dir} is not a folder (${messageOf(error)})`, {
      cause: error,
    });
  }
  const problems: string[] = [];
  const found: Found[] = [];
  let looked = 0;
  for (const folder of folders) {
    const file = path.join(dir, folder, 'feature.json');
    // oxlint-disable-next-line no-await-in-loop -- folders are checked in name order so problems read the same every time
    const source = await readIfExists(ops, file);
    if (source === undefined) continue;
    looked += 1;
    const label = `${folder}/feature.json`;
    try {
      const manifest = parseFeature(source, 'third-party', label);
      const slash = manifest.name.indexOf('/');
      const bare = manifest.name.slice(slash + 1);
      const own = (problem: string) => problems.push(`${label}: ${problem}`);
      if (bare === 'index') own('"index" is taken by the registry index; pick another name');
      if (valid(manifest.version) === null) {
        own(`version "${manifest.version}" must be a semver version like 1.0.0`);
      }
      if ((manifest.description ?? '') === '') {
        own('description is required; `mfeflow features` shows it next to the name');
      }
      found.push({
        folder,
        namespace: manifest.name.slice(0, slash),
        bare,
        version: manifest.version,
        description: manifest.description ?? '',
        keywords: manifest.keywords,
        json: text(manifest),
      });
    } catch (error) {
      if (!isMfeflowError(error)) throw error;
      problems.push(error.message.includes(label) ? error.message : `${label}: ${error.message}`);
    }
  }
  if (looked === 0) {
    throw new MfeflowError('E404', `no <folder>/feature.json found in ${dir}`, {
      fix: 'Put each feature in its own folder next to the others: my-registry/hello/feature.json.',
    });
  }

  const namespaces = new Set(found.map((f) => f.namespace));
  if (namespaces.size > 1) {
    problems.push(
      `one registry serves one namespace, but this folder has ${[...namespaces].toSorted().join(', ')}`,
    );
  }
  const names = new Map<string, string>();
  for (const f of found) {
    const earlier = names.get(f.bare);
    if (earlier !== undefined) {
      problems.push(`${f.folder}/feature.json: ${f.bare} is already defined by ${earlier}`);
    }
    names.set(f.bare, `${f.folder}/feature.json`);
  }

  const files: RegistryFile[] = [];
  const features: RegistryBuild['features'] = [];
  const items: FeatureRegistryItem[] = [];
  for (const f of found.toSorted((a, b) => a.bare.localeCompare(b.bare))) {
    const paths = [`${f.bare}.json`, `${f.bare}/${f.version}.json`, `${f.bare}/latest.json`];
    if (Buffer.byteLength(f.json, 'utf8') > MAX_BYTES) {
      problems.push(`${f.folder}/feature.json: is larger than 1 MB, which users' installs refuse`);
    }
    for (const p of paths) files.push({ path: p, content: f.json });
    features.push({ name: `${f.namespace}/${f.bare}`, version: f.version, files: paths });
    items.push({
      name: f.bare,
      version: f.version,
      description: f.description,
      ...(f.keywords === undefined || f.keywords.length === 0 ? {} : { keywords: f.keywords }),
    });
  }
  const index: FeatureRegistryIndex = { $schema: SCHEMA_URLS.featureRegistryIndex, items };
  for (const issue of validateFeatureRegistryIndex(index)) {
    problems.push(`index.json: ${issue.path} ${issue.message}`);
  }
  if (problems.length > 0) {
    const list = problems.map((p) => `\n  - ${p}`).join('');
    throw new MfeflowError('E404', `${String(problems.length)} problem(s)${list}`);
  }
  files.push({ path: 'index.json', content: text(index) });
  return { namespace: [...namespaces][0] ?? '', index, features, files };
}
