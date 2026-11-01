import { EXPOSE, MFE_NAME, SCHEMA_URLS, type MfeflowProject } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import type { DetectedApp, FederationReport, NotAdopted } from './types';

/** Names the feature targets use for groups of apps, so no app may take them. */
const RESERVED = new Set(['root', 'remotes']);
const DEV_PORT_START = 4311;
const OWNER_PLACEHOLDER = 'unassigned';

export interface AdoptInput {
  report: FederationReport;
  scope: string;
  packageManager: MfeflowProject['packageManager'];
}

/** One `mfeflow.app.json` adopt will write, as plain data. */
export interface AdoptAppFile {
  name: string;
  /** Folder of the app, relative to the project, `/` separated. `.` for the project itself. */
  dir: string;
  role: 'shell' | 'remote';
  content: Record<string, unknown>;
}

/** A remote that gets `registry/envs/<env>/<name>.json`. */
export interface AdoptRemote {
  name: string;
  port: number;
}

export interface AdoptPlan {
  /** The `mfeflow.json` content, before the CLI stamps its version. */
  project: MfeflowProject;
  appFiles: AdoptAppFile[];
  remotes: AdoptRemote[];
  /** Folders of the shells; `@mfeflow/runtime` goes into each package.json. */
  shellDirs: string[];
  /** What the detector skipped plus what adopt itself could not carry, each with a reason. */
  notAdopted: NotAdopted[];
  /** Things the person should look at, in plain words. */
  warnings: string[];
}

const join = (dir: string, file: string): string => (dir === '.' ? file : `${dir}/${file}`);

function localPort(entry: string): number | undefined {
  try {
    const url = new URL(entry);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const port = Number(url.port);
    return local && Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

function skip(app: DetectedApp, field: string, reason: string): NotAdopted {
  return { dir: app.dir, file: app.federationFile ?? app.configFile, field, reason };
}

/** The apps adopt can name: a literal Module Federation name that is valid, unreserved and unique. */
function nameApps(
  apps: readonly DetectedApp[],
  notAdopted: NotAdopted[],
): { app: DetectedApp; name: string }[] {
  const taken = new Set<string>();
  const named: { app: DetectedApp; name: string }[] = [];
  for (const app of apps) {
    const { name } = app;
    let problem: string | undefined;
    if (name === undefined) problem = 'has no literal name, so there is nothing to call this app';
    else if (!MFE_NAME.test(name))
      problem = `"${name}" is not a name mfeflow accepts (lowercase letters, digits and single _)`;
    else if (RESERVED.has(name) || (app.role === 'remote' && name === 'shell'))
      problem = `"${name}" is a name mfeflow keeps for itself`;
    else if (taken.has(name)) problem = `"${name}" is already used by another app`;
    if (name === undefined || problem !== undefined) {
      notAdopted.push(skip(app, 'name', `${problem ?? ''}; the app was left out`));
      continue;
    }
    taken.add(name);
    named.push({ app, name });
  }
  return named;
}

function exposesOf(app: DetectedApp, notAdopted: NotAdopted[]): string[] {
  const kept: string[] = [];
  for (const key of Object.keys(app.exposes)) {
    if (EXPOSE.test(key)) kept.push(key);
    else
      notAdopted.push(
        skip(app, `exposes['${key}']`, 'is not a ./Name path, which mfeflow.app.json requires'),
      );
  }
  return kept;
}

function platformOf(app: DetectedApp): Record<string, string> {
  const platform: Record<string, string> = {};
  for (const [pkg, shared] of Object.entries(app.shared)) {
    if (typeof shared.requiredVersion === 'string') platform[pkg] = shared.requiredVersion;
  }
  return platform;
}

/** Shells whose `remotes` load the remote called `name`, by alias or by federation name. */
function shellsLoading(name: string, shells: readonly { app: DetectedApp; name: string }[]) {
  return shells
    .filter(({ app }) =>
      Object.entries(app.remotes).some(([alias, remote]) => (remote.name ?? alias) === name),
    )
    .map((shell) => shell.name);
}

function portFor(
  remote: { app: DetectedApp; name: string },
  shells: readonly { app: DetectedApp }[],
  used: Set<number>,
  warnings: string[],
): number {
  const { app, name } = remote;
  const fromShell = shells
    .flatMap((shell) => Object.entries(shell.app.remotes))
    .filter(([alias, r]) => (r.name ?? alias) === name)
    .map(([, r]) => localPort(r.entry))
    .find((port) => port !== undefined);
  const known = app.port ?? fromShell;
  if (known !== undefined) return known;
  let port = DEV_PORT_START;
  while (used.has(port)) port += 1;
  warnings.push(
    `${name}: no dev port found in its config, so its dev registry entry uses ${String(port)}; change it if the app runs elsewhere`,
  );
  return port;
}

/**
 * Turns what {@link detectFederation} found into the files adopt writes, as data. Needs a
 * shell: without one the project file would not validate, and a lone remote belongs to a
 * multi-repo setup this release does not write.
 */
export function planAdoption(input: AdoptInput): AdoptPlan {
  const notAdopted: NotAdopted[] = [...input.report.notAdopted];
  const warnings: string[] = [];
  const named = nameApps(input.report.apps, notAdopted);
  const shells = named.filter(({ app }) => app.role === 'shell');
  const remotes = named.filter(({ app }) => app.role === 'remote');
  if (shells.length === 0) {
    const found =
      input.report.apps.length === 0
        ? 'no Module Federation config was found'
        : remotes.length > 0
          ? `only remotes were found (${remotes.map((r) => r.name).join(', ')}), and no shell that loads them`
          : 'no app had a usable name';
    throw new MfeflowError('E124', found);
  }

  const apps: MfeflowProject['apps'] = {};
  const used = new Set(named.flatMap(({ app }) => (app.port === undefined ? [] : [app.port])));
  const appFiles: AdoptAppFile[] = [];
  const adoptedRemotes: AdoptRemote[] = [];
  for (const entry of named) {
    const { app, name } = entry;
    apps[name] = {
      kind: app.role,
      path: app.dir,
      ...(app.port === undefined ? {} : { port: app.port }),
    };
    const platform = platformOf(app);
    appFiles.push({
      name,
      dir: app.dir,
      role: app.role,
      content: {
        $schema: SCHEMA_URLS.mfe,
        name,
        owner: OWNER_PLACEHOLDER,
        shells: app.role === 'remote' ? shellsLoading(name, shells) : [],
        routes: [],
        exposes: exposesOf(app, notAdopted),
        ...(Object.keys(platform).length > 0 ? { platform } : {}),
      },
    });
    if (app.role === 'remote') {
      adoptedRemotes.push({ name, port: portFor(entry, shells, used, warnings) });
    }
  }
  warnings.unshift(
    `routes are empty (mfeflow cannot read them from a build config); add the paths each app serves to ${appFiles.map((f) => join(f.dir, 'mfeflow.app.json')).join(', ')}`,
  );
  const scriptOnly = remotes
    .flatMap(({ name }) =>
      shells
        .flatMap(({ app }) => Object.entries(app.remotes))
        .filter(([alias, r]) => (r.name ?? alias) === name && r.type === 'script'),
    )
    .map(([alias]) => alias);
  if (scriptOnly.length > 0) {
    warnings.push(
      `${[...new Set(scriptOnly)].join(', ')}: loaded from a remoteEntry.js, but the registry entries point at mf-manifest.json; check that the remote builds one`,
    );
  }
  const fromElsewhere = shells
    .flatMap(({ app }) => Object.entries(app.remotes))
    .filter(([alias, r]) => !named.some((n) => n.name === (r.name ?? alias)))
    .map(([alias]) => alias);
  if (fromElsewhere.length > 0) {
    warnings.push(
      `${[...new Set(fromElsewhere)].join(', ')}: loaded by a shell but not found in this folder, so no app or registry entry was written`,
    );
  }
  if (adoptedRemotes.length > 0) {
    warnings.push(
      'registry entries for staging and prod point at example.com; set the real addresses before you deploy',
    );
  }

  return {
    project: {
      version: 1,
      topology: 'monorepo',
      packageManager: input.packageManager,
      scope: input.scope,
      apps,
      features: {},
    },
    appFiles,
    remotes: adoptedRemotes,
    shellDirs: shells.map(({ app }) => app.dir),
    notAdopted,
    warnings,
  };
}
