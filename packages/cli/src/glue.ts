import fs from 'node:fs/promises';
import path from 'node:path';
import { MFE_NAME, type FeatureFile, type TransformOp } from '@mfeflow/contracts';
import {
  MfeflowError,
  renderTemplate,
  type LoadedFeature,
  type MfeflowProject,
} from '@mfeflow/core';
import type { AssetRoots } from './assets';

export const SHELL_PORT = 4300;
export const REMOTE_PORT = 4311;

/** Names the feature targets use for groups of apps, so no app may take them. */
const RESERVED = new Set(['root', 'shell', 'remotes']);

export function assertAppName(name: string, apps: MfeflowProject['apps'] = {}): void {
  if (!MFE_NAME.test(name)) {
    throw new MfeflowError('E215', `"${name}" is not a Module Federation name`);
  }
  if (RESERVED.has(name)) throw new MfeflowError('E215', `"${name}" is a reserved name`);
  if (name in apps) throw new MfeflowError('E215', `"${name}" is already an app`);
}

function usedPorts(project: Pick<MfeflowProject, 'apps'>): Set<number> {
  return new Set(
    Object.values(project.apps).flatMap((app) => (app.port === undefined ? [] : [app.port])),
  );
}

/** The first free port from `start` upwards. */
export function freePort(project: Pick<MfeflowProject, 'apps'>, start: number): number {
  const used = usedPorts(project);
  let port = start;
  while (used.has(port)) port += 1;
  return port;
}

function pascal(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function routeComponent(remote: string): string {
  return `${pascal(remote)}Route`;
}

export const REGISTRY_ENVS = ['dev', 'staging', 'prod'] as const;

const ENV_HOSTS = {
  staging: 'https://staging.example.com',
  prod: 'https://app.example.com',
} as const;

async function glueTemplate(roots: AssetRoots, file: string): Promise<string> {
  return fs.readFile(path.join(roots.templates, 'monorepo', 'glue', file), 'utf8');
}

export interface RemoteSpec {
  name: string;
  port: number;
}

export interface GlueOptions {
  roots: AssetRoots;
  /** Version of the `core` feature, so the plan records what generated these files. */
  version: string;
  remote: RemoteSpec;
  /** Write `registry/envs/<env>/<name>.json`. */
  registry: boolean;
  /** Apps (a shell name, or "shell" for every shell) that get a route to the remote. */
  shells: readonly string[];
}

export interface RegistryEntryFile {
  path: string;
  content: string;
}

const asFeatureFile = (file: RegistryEntryFile): FeatureFile => ({
  to: file.path,
  content: file.content,
});

/** `registry/envs/<env>/<name>.json` for dev, staging and prod: dev points at the remote's dev server. */
export async function registryEntryFiles(
  roots: AssetRoots,
  remote: RemoteSpec,
  envs: readonly string[] = REGISTRY_ENVS,
): Promise<RegistryEntryFile[]> {
  const { name, port } = remote;
  const template = await glueTemplate(roots, 'registry-entry.json.eta');
  const urls: Record<string, { version: string; manifestUrl: string }> = {
    dev: { version: 'dev', manifestUrl: `http://localhost:${String(port)}/mf-manifest.json` },
    staging: { version: '0.0.0', manifestUrl: `${ENV_HOSTS.staging}/mfe/${name}/mf-manifest.json` },
    prod: { version: '0.0.0', manifestUrl: `${ENV_HOSTS.prod}/mfe/${name}/mf-manifest.json` },
  };
  return envs.flatMap((env) => {
    const entry = urls[env];
    if (entry === undefined) return [];
    return [
      {
        path: `registry/envs/${env}/${name}.json`,
        content: renderTemplate(template, { name, ...entry }, `registry/${env}`),
      },
    ];
  });
}

/**
 * The parts of adding a remote that belong to no single app: its registry
 * entries, and a route in each shell. Returned as a feature so the engine
 * applies it like any other, with the same checks and the same plan.
 */
export async function remoteGlue(options: GlueOptions): Promise<LoadedFeature> {
  const { name } = options.remote;
  const files: FeatureFile[] = [];
  const transforms: TransformOp[] = [];
  if (options.registry) {
    files.push(...(await registryEntryFiles(options.roots, options.remote)).map(asFeatureFile));
  }
  if (options.shells.length > 0) {
    const route = await glueTemplate(options.roots, 'route.tsx.eta');
    const component = routeComponent(name);
    for (const target of options.shells) {
      files.push({
        to: `src/remotes/${name}.tsx`,
        target,
        content: renderTemplate(route, { name, component }, 'route'),
      });
      transforms.push({
        op: 'add-route',
        file: 'src/remotes/route-table.tsx',
        target,
        path: `/${name}`,
        component,
        from: `./${name}`,
      });
    }
  }
  return {
    manifest: { name: 'core', version: options.version, files, transforms },
    trust: 'first-party',
  };
}

/**
 * The parts of `feature` that target `from` (`shell` or `remotes`), retargeted
 * at one app, so a new app gets what every existing one of its kind got.
 * Undefined when the feature has nothing for that kind.
 */
export function partsForApp(
  feature: LoadedFeature,
  from: 'shell' | 'remotes',
  app: string,
): LoadedFeature | undefined {
  const { manifest } = feature;
  const mine = <T extends { target?: string }>(items: T[] | undefined): T[] =>
    (items ?? [])
      .filter((item) => item.target === from)
      .map((item) => Object.assign({}, item, { target: app }));
  const files = mine(manifest.files);
  const dependencies = mine(manifest.dependencies);
  const scripts = mine(manifest.scripts);
  const transforms = mine(manifest.transforms);
  if (files.length + dependencies.length + scripts.length + transforms.length === 0) {
    return undefined;
  }
  return {
    ...feature,
    manifest: {
      name: manifest.name,
      version: manifest.version,
      ...(manifest.prompts ? { prompts: manifest.prompts } : {}),
      files,
      dependencies,
      scripts,
      transforms,
    },
  };
}
