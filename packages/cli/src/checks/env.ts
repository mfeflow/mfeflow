import fs from 'node:fs/promises';
import path from 'node:path';
import {
  dotenvKeys,
  messageOf,
  runtimeConfigFiles,
  schemaKeys,
  type SchemaKey,
} from '@mfeflow/core';
import { done, finding, type Check, type CheckOutcome, type Finding } from '../findings';
import { readText, type ProjectView } from '../inspect';

/** Decision 0020. Every check below does nothing until the env-t3 feature is installed. */
const NOT_INSTALLED = 'the env-t3 feature is not installed';
const installed = ({ project }: ProjectView) => 'env-t3' in project.features;

/** Values that are the same in every environment, so inlining them at build time is fine. */
const PUBLIC_CONSTANTS = new Set(['PUBLIC_APP_NAME', 'PUBLIC_BUILD_VERSION']);
const PUBLIC_VAR = /\bPUBLIC_[A-Z0-9_]+\b/g;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

interface Place {
  /** App name, or `root`. */
  name: string;
  dir: string;
  /** Path from the project root, empty for the root. */
  rel: string;
}

const places = (view: ProjectView): Place[] => [
  { name: 'root', dir: view.root, rel: '' },
  ...view.apps.filter((a) => a.present).map((a) => ({ name: a.name, dir: a.dir, rel: a.rel })),
];

const warning = (app: string, file: string) => ({
  app,
  path: file,
  severity: 'warning' as const,
});

const at = (place: Place, file: string) => (place.rel === '' ? file : `${place.rel}/${file}`);

/** Runs `check` for every place; each returns its findings. */
async function eachPlace(
  view: ProjectView,
  check: (place: Place) => Promise<Finding[]>,
): Promise<CheckOutcome> {
  if (!installed(view)) return { findings: [], skipped: NOT_INSTALLED };
  return done((await Promise.all(places(view).map(check))).flat());
}

interface ServerKeys {
  keys: SchemaKey[];
  /** Set when env.ts exists but could not be read. */
  problem?: string;
}

/** The `server` keys of a place's env.ts; undefined when it has no env.ts. */
async function serverKeysOf(place: Place): Promise<ServerKeys | undefined> {
  const source = await readText(path.join(place.dir, 'env.ts'));
  if (source === undefined) return undefined;
  try {
    const keys = schemaKeys(source, 'env.ts', 'server');
    if (keys === undefined) return { keys: [], problem: 'it has no createEnv({ server: { … } })' };
    return { keys };
  } catch (error) {
    return { keys: [], problem: messageOf(error) };
  }
}

export const envExample: Check = {
  id: 'env.example',
  title: '.env.example lists the required keys of env.ts and no others (decision 0020)',
  run: (view) =>
    eachPlace(view, async (place) => {
      const server = await serverKeysOf(place);
      if (server === undefined || server.problem !== undefined) return [];
      const names = new Set(server.keys.map((k) => k.name));
      const required = server.keys.filter((k) => !k.optional).map((k) => k.name);
      const file = at(place, '.env.example');
      const example = await readText(path.join(place.dir, '.env.example'));
      const options = { app: place.name, path: file, severity: 'warning' as const };
      if (example === undefined) {
        return required.length === 0
          ? []
          : [finding('env.example', 'E118', `${file} is missing`, options)];
      }
      const listed = dotenvKeys(example);
      return [
        ...required
          .filter((key) => !listed.includes(key))
          .map((key) =>
            finding(
              'env.example',
              'E118',
              `${key} is in ${at(place, 'env.ts')} but not in ${file}`,
              options,
            ),
          ),
        ...listed
          .filter((key) => !names.has(key))
          .map((key) =>
            finding(
              'env.example',
              'E118',
              `${key} is in ${file} but not in ${at(place, 'env.ts')}`,
              options,
            ),
          ),
      ];
    }),
};

async function checkConfigFile(
  place: Place,
  folder: string,
  name: string,
  keys: readonly SchemaKey[],
): Promise<Finding[]> {
  const file = at(place, `public/config/${name}`);
  const options = { app: place.name, path: file };
  const extra = warning(place.name, file);
  let json: unknown;
  try {
    json = JSON.parse((await readText(path.join(folder, name))) ?? '');
  } catch (error) {
    return [
      finding(
        'env.runtime-config',
        'E119',
        `${file} is not valid JSON (${messageOf(error)})`,
        options,
      ),
    ];
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return [finding('env.runtime-config', 'E119', `${file} is not a JSON object`, options)];
  }
  const present = Object.keys(json);
  return [
    ...keys
      .filter((k) => !k.optional && !present.includes(k.name))
      .map((k) => finding('env.runtime-config', 'E119', `${file} is missing ${k.name}`, options)),
    ...present
      .filter((key) => !keys.some((k) => k.name === key))
      .map((key) =>
        finding(
          'env.runtime-config',
          'E119',
          `${file} has ${key}, which the schema does not`,
          extra,
        ),
      ),
  ];
}

export const runtimeConfig: Check = {
  id: 'env.runtime-config',
  title:
    'every runtime-config.<env>.json has the keys of the runtime-config schema (decision 0020)',
  run: (view) =>
    eachPlace(view, async (place) => {
      const source = await readText(path.join(place.dir, 'src', 'config', 'schema.ts'));
      if (source === undefined) return [];
      const schemaFile = at(place, 'src/config/schema.ts');
      let keys;
      try {
        keys = schemaKeys(source, schemaFile, 'runtime');
      } catch (error) {
        return [
          finding('env.runtime-config', 'E119', `${schemaFile}: ${messageOf(error)}`, {
            app: place.name,
            path: schemaFile,
          }),
        ];
      }
      if (keys === undefined) {
        return [
          finding('env.runtime-config', 'E119', `${schemaFile} has no runtimeConfigSchema object`, {
            app: place.name,
            path: schemaFile,
          }),
        ];
      }
      const folder = path.join(place.dir, 'public', 'config');
      const files = await runtimeConfigFiles(folder);
      const found = await Promise.all(
        files.map((name) => checkConfigFile(place, folder, name, keys)),
      );
      return found.flat();
    }),
};

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
      return SOURCE_FILE.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

export const publicPrefix: Check = {
  id: 'env.public-prefix',
  title: 'no PUBLIC_ variable is baked into a bundle except constants (decision 0020)',
  run: (view) =>
    eachPlace(view, async (place) => {
      const files = [
        path.join(place.dir, 'env.ts'),
        path.join(place.dir, '.env.example'),
        ...(await sourceFiles(path.join(place.dir, 'src'))),
      ];
      const found = await Promise.all(
        files.map(async (file): Promise<Finding[]> => {
          const source = await readText(file);
          if (source === undefined) return [];
          const names = [...new Set(source.match(PUBLIC_VAR) ?? [])].filter(
            (name) => !PUBLIC_CONSTANTS.has(name),
          );
          const shown = path.relative(view.root, file).split(path.sep).join('/');
          return names.map((name) =>
            finding('env.public-prefix', 'E120', `${name} in ${shown}`, {
              app: place.name,
              path: shown,
              severity: 'warning',
            }),
          );
        }),
      );
      return found.flat();
    }),
};

export const turboEnv: Check = {
  id: 'env.turbo',
  title: 'every required server env key is listed in turbo.json (decision 0020)',
  run: async (view) => {
    if (!installed(view)) return { findings: [], skipped: NOT_INSTALLED };
    const source = await readText(path.join(view.root, 'turbo.json'));
    if (source === undefined) return { findings: [], skipped: 'there is no turbo.json' };
    let listed: string[] = [];
    try {
      listed = turboEnvNames(JSON.parse(source));
    } catch {
      return { findings: [], skipped: 'turbo.json is not valid JSON' };
    }
    return eachPlace(view, async (place) => {
      const server = await serverKeysOf(place);
      return (server?.keys ?? [])
        .filter((key) => !key.optional && !listed.includes(key.name))
        .map((key) =>
          finding('env.turbo', 'E121', `${key.name} from ${at(place, 'env.ts')}`, {
            app: place.name,
            path: 'turbo.json',
            severity: 'warning',
          }),
        );
    });
  },
};

/** Every name under `globalEnv`, `globalPassThroughEnv` and a task's `env` or `passThroughEnv`. */
function turboEnvNames(turbo: unknown): string[] {
  const names: string[] = [];
  const visit = (value: unknown, key: string): void => {
    if (
      Array.isArray(value) &&
      ['globalEnv', 'globalPassThroughEnv', 'env', 'passThroughEnv'].includes(key)
    ) {
      names.push(...value.filter((v): v is string => typeof v === 'string'));
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(turbo, '');
  return names;
}

export const envChecks: readonly Check[] = [envExample, runtimeConfig, publicPrefix, turboEnv];
