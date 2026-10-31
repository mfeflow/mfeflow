import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validateMfeManifest,
  validateRegistryEntry,
  type Issue,
  type MfeManifest,
  type RegistryEntry,
} from '@mfeflow/contracts';
import { hasErrno, loadProject, messageOf, type MfeflowProject } from '@mfeflow/core';
import { parse as parseYaml } from 'yaml';
import { SINGLETON_PACKAGES } from './singletons';

export const ENVS = ['dev', 'staging', 'prod'] as const;

export type Read<T> =
  { state: 'missing' } | { state: 'invalid'; issues: Issue[] } | { state: 'ok'; value: T };

export interface PackageView {
  name?: string;
  version?: string;
  /** dependencies, devDependencies and peerDependencies, `catalog:` already resolved. */
  deps: Record<string, string>;
}

export interface AppView {
  name: string;
  kind: 'shell' | 'remote';
  /** Path from `mfeflow.json`. */
  rel: string;
  dir: string;
  port: number | undefined;
  /** The folder has a package.json. */
  present: boolean;
  pkg: PackageView | undefined;
  mfe: Read<MfeManifest>;
}

export interface WorkspacePackage {
  dir: string;
  rel: string;
  pkg: PackageView;
  hasVersion: boolean;
}

export interface ProjectView {
  root: string;
  project: MfeflowProject;
  apps: AppView[];
  workspace: WorkspacePackage[];
  /** env → remote name → entry. Only remotes with a file in that env are listed. */
  registry: Record<string, Record<string, Read<RegistryEntry>>>;
  /** Folders under registry/envs that exist. */
  envDirs: string[];
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR') || hasErrno(error, 'EISDIR')) {
      return undefined;
    }
    throw error;
  }
}

async function readJson(file: string): Promise<Read<unknown>> {
  const text = await readText(file);
  if (text === undefined) return { state: 'missing' };
  try {
    return { state: 'ok', value: JSON.parse(text) };
  } catch (error) {
    return {
      state: 'invalid',
      issues: [{ path: '', message: `not valid JSON (${messageOf(error)})` }],
    };
  }
}

interface Catalogs {
  default: Record<string, string>;
  named: Record<string, Record<string, string>>;
}

function strings(value: unknown): Record<string, string> {
  if (!isObj(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

async function readWorkspaceFile(root: string): Promise<{ globs: string[]; catalogs: Catalogs }> {
  const text = await readText(path.join(root, 'pnpm-workspace.yaml'));
  const empty = { globs: [], catalogs: { default: {}, named: {} } };
  if (text === undefined) return empty;
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return empty;
  }
  if (!isObj(doc)) return empty;
  const globs = Array.isArray(doc.packages)
    ? doc.packages.filter((g): g is string => typeof g === 'string')
    : [];
  const named = isObj(doc.catalogs)
    ? Object.fromEntries(Object.entries(doc.catalogs).map(([k, v]) => [k, strings(v)]))
    : {};
  return { globs, catalogs: { default: strings(doc.catalog), named } };
}

async function subfolders(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name !== 'node_modules')
      .map((e) => e.name)
      .toSorted((a, b) => a.localeCompare(b));
  } catch (error) {
    if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return [];
    throw error;
  }
}

/** A `!` pattern as a regex over a folder's path from the root: `*` stays in a segment, `**` crosses them. */
function excluder(pattern: string): RegExp {
  const body = pattern
    .replace(/\/$/, '')
    .split('/')
    .map((part) =>
      part === '**'
        ? '\u0000'
        : part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '[^/]*'),
    )
    .join('/')
    .replaceAll('\u0000/', '(?:.*/)?')
    .replaceAll('/\u0000', '(?:/.*)?')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${body}$`);
}

/** Workspace folders for the simple globs pnpm projects use: `dir/*`, plain paths, and `!` exclusions. */
export async function expandGlobs(root: string, globs: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const excluded = globs.filter((g) => g.startsWith('!')).map((g) => excluder(g.slice(1)));
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    const clean = glob.replace(/\/$/, '');
    if (clean.endsWith('/*') || clean.endsWith('/**')) {
      const base = clean.replace(/\/\*{1,2}$/, '');
      // oxlint-disable-next-line no-await-in-loop -- a handful of globs
      for (const name of await subfolders(path.join(root, base))) out.push(`${base}/${name}`);
    } else {
      out.push(clean);
    }
  }
  return [...new Set(out)].filter((rel) => !excluded.some((pattern) => pattern.test(rel)));
}

function resolveSpec(name: string, spec: string, catalogs: Catalogs): string {
  if (spec === 'catalog:' || spec === 'catalog:default') return catalogs.default[name] ?? spec;
  if (spec.startsWith('catalog:'))
    return catalogs.named[spec.slice('catalog:'.length)]?.[name] ?? spec;
  return spec;
}

async function readPackage(dir: string, catalogs: Catalogs): Promise<PackageView | undefined> {
  const read = await readJson(path.join(dir, 'package.json'));
  if (read.state !== 'ok' || !isObj(read.value)) return undefined;
  const deps: Record<string, string> = {};
  for (const key of ['peerDependencies', 'devDependencies', 'dependencies']) {
    for (const [name, spec] of Object.entries(strings(read.value[key]))) {
      deps[name] = resolveSpec(name, spec, catalogs);
    }
  }
  const view: PackageView = { deps };
  if (typeof read.value.name === 'string') view.name = read.value.name;
  if (typeof read.value.version === 'string') view.version = read.value.version;
  return view;
}

async function readMfe(dir: string): Promise<Read<MfeManifest>> {
  const read = await readJson(path.join(dir, 'mfe.json'));
  if (read.state !== 'ok') return read;
  const issues = validateMfeManifest(read.value);
  if (issues.length > 0) return { state: 'invalid', issues };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated just above
  return { state: 'ok', value: read.value as MfeManifest };
}

async function readRegistry(root: string): Promise<{
  registry: ProjectView['registry'];
  envDirs: string[];
}> {
  const envsDir = path.join(root, 'registry', 'envs');
  const envDirs = await subfolders(envsDir);
  const registry: ProjectView['registry'] = {};
  for (const env of envDirs) {
    const entries: Record<string, Read<RegistryEntry>> = {};
    const dir = path.join(envsDir, env);
    // oxlint-disable-next-line no-await-in-loop -- a few folders
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .toSorted((a, b) => a.localeCompare(b));
    for (const file of files) {
      // oxlint-disable-next-line no-await-in-loop -- a few files
      const read = await readJson(path.join(dir, file));
      const name = file.slice(0, -'.json'.length);
      if (read.state !== 'ok') {
        entries[name] = read;
        continue;
      }
      const issues = validateRegistryEntry(read.value);
      if (issues.length > 0) {
        entries[name] = { state: 'invalid', issues };
        continue;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated just above
      entries[name] = { state: 'ok', value: read.value as RegistryEntry };
    }
    registry[env] = entries;
  }
  return { registry, envDirs };
}

/** Everything the checks read, loaded once. Throws the E102-E104 errors of `loadProject`. */
export async function inspectProject(root: string): Promise<ProjectView> {
  const project = await loadProject(root);
  const { globs, catalogs } = await readWorkspaceFile(root);
  const apps = await Promise.all(
    Object.entries(project.apps).map(async ([name, app]): Promise<AppView> => {
      const dir = path.join(root, ...app.path.split('/'));
      const pkg = await readPackage(dir, catalogs);
      return {
        name,
        kind: app.kind,
        rel: app.path,
        dir,
        port: app.port,
        present: pkg !== undefined,
        pkg,
        mfe: await readMfe(dir),
      };
    }),
  );
  const folders = await expandGlobs(root, globs);
  const workspace = (
    await Promise.all(
      folders.map(async (rel): Promise<WorkspacePackage | undefined> => {
        const dir = path.join(root, ...rel.split('/'));
        const pkg = await readPackage(dir, catalogs);
        return pkg && { dir, rel, pkg, hasVersion: pkg.version !== undefined };
      }),
    )
  ).filter((p) => p !== undefined);
  return { root, project, apps, workspace, ...(await readRegistry(root)) };
}

/**
 * The version of `name` an app uses: what is installed under node_modules (walking up from
 * the app to the project root, as Node does, never above it), else the version its package.json
 * declares. Only packages the app declares or the shared list names are looked up.
 */
export async function versionIn(
  app: Pick<AppView, 'dir' | 'pkg'>,
  name: string,
  root: string,
): Promise<string | undefined> {
  const declared = app.pkg?.deps[name];
  if (declared === undefined && !SINGLETON_PACKAGES.includes(name)) return undefined;
  let dir = app.dir;
  while (!path.relative(root, dir).startsWith('..')) {
    // oxlint-disable-next-line no-await-in-loop -- walks up one folder at a time
    const text = await readText(path.join(dir, 'node_modules', ...name.split('/'), 'package.json'));
    if (text !== undefined) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (isObj(parsed) && typeof parsed.version === 'string') return parsed.version;
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return declared;
}
