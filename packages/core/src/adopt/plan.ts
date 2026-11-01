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

/** Control characters in config-derived text would let a config rewrite the terminal. */
const CONTROL = new RegExp(String.raw`[\u0000-\u001f\u007f-\u009f]`, 'g');
export const printable = (text: string): string => text.replaceAll(CONTROL, '?');

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

/** The port a shell's localhost URL gives for the remote called `name`. */
function portFromShells(name: string, shells: readonly { app: DetectedApp }[]): number | undefined {
  return shells
    .flatMap((shell) => Object.entries(shell.app.remotes))
    .filter(([alias, r]) => (r.name ?? alias) === name)
    .map(([, r]) => localPort(r.entry))
    .find((port) => port !== undefined);
}

/**
 * The dev port of every remote: declared, else from a shell's localhost URL, else the next free
 * one from 4311. Every port in use is recorded, and two apps on one port are warned about.
 */
function assignPorts(
  named: readonly { app: DetectedApp; name: string }[],
  shells: readonly { app: DetectedApp }[],
  warnings: string[],
): Map<string, number> {
  const claims = new Map<number, string[]>();
  const claim = (port: number, name: string): void => {
    claims.set(port, [...(claims.get(port) ?? []), name]);
  };
  const ports = new Map<string, number>();
  const portless: string[] = [];
  for (const { app, name } of named) {
    const port = app.port ?? (app.role === 'remote' ? portFromShells(name, shells) : undefined);
    if (port === undefined) {
      if (app.role === 'remote') portless.push(name);
      continue;
    }
    claim(port, name);
    if (app.role === 'remote') ports.set(name, port);
  }
  for (const [port, names] of claims) {
    if (names.length > 1) {
      warnings.push(`${names.join(', ')} are all on port ${String(port)}; give each app its own`);
    }
  }
  let next = DEV_PORT_START;
  for (const name of portless) {
    while (claims.has(next)) next += 1;
    claim(next, name);
    ports.set(name, next);
    warnings.push(
      `${name}: no dev port found in its config, so its dev registry entry uses ${String(next)}; change it if the app runs elsewhere`,
    );
  }
  return ports;
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
  const ports = assignPorts(named, shells, warnings);
  const appFiles: AdoptAppFile[] = [];
  const adoptedRemotes: AdoptRemote[] = [];
  for (const { app, name } of named) {
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
    const port = ports.get(name);
    if (app.role === 'remote' && port !== undefined) adoptedRemotes.push({ name, port });
  }
  warnings.unshift(
    `routes are empty (mfeflow cannot read them from a build config); add the paths each app serves to ${appFiles.map((f) => printable(join(f.dir, 'mfeflow.app.json'))).join(', ')}`,
  );
  const scriptOnly = remotes
    .flatMap(({ name }) =>
      shells
        .flatMap(({ app }) => Object.entries(app.remotes))
        .filter(([alias, r]) => (r.name ?? alias) === name && r.type === 'script'),
    )
    .map(([alias]) => printable(alias));
  if (scriptOnly.length > 0) {
    warnings.push(
      `${[...new Set(scriptOnly)].join(', ')}: loaded from a remoteEntry.js, but the registry entries point at mf-manifest.json; check that the remote builds one`,
    );
  }
  const fromElsewhere = shells
    .flatMap(({ app }) => Object.entries(app.remotes))
    .filter(([alias, r]) => !named.some((n) => n.name === (r.name ?? alias)))
    .map(([alias]) => printable(alias));
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
    notAdopted: notAdopted.map((item) => ({
      dir: printable(item.dir),
      file: printable(item.file),
      field: printable(item.field),
      reason: printable(item.reason),
    })),
    warnings,
  };
}
