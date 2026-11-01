import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MfeManifest,
  RegistryEntry,
  RegistryIndex,
  RegistryIndexRemote,
} from '@mfeflow/contracts';
import { findProjectRoot, messageOf, MfeflowError, type ErrorCode } from '@mfeflow/core';
import {
  applyPlan,
  HostError,
  indexKey,
  PreconditionFailedError,
  readIndex,
  type ApplyResult,
  type DeployPlan,
  type GateCode,
  type RegistryHost,
} from '@mfeflow/registry/static';
import { readGlobals, text, type Globals } from './args';
import { finding, type Finding } from './findings';
import { describeHost, openHost, parseHostSpec, redact, secretsOf } from './hosts';
import { inspectProject, versionIn, type AppView, type ProjectView } from './inspect';
import type { PlannedUpload } from './output';
import type { Runtime } from './runtime';
import { SINGLETON_PACKAGES } from './singletons';

export const GATE_CODES: Record<GateCode, ErrorCode> = {
  schema: 'E501',
  'route-overlap': 'E502',
  compat: 'E503',
  budget: 'E504',
  rollout: 'E505',
};

export interface Session {
  rt: Runtime;
  globals: Globals;
  view: ProjectView;
  host: RegistryHost;
  hostLabel: string;
  /** Secret values to scrub from anything printed. */
  secrets: string[];
  /** `--base-url`, else `registry.baseUrl` from mfeflow.json. */
  baseUrl: string | undefined;
}

const ENV_NAME = /^[a-z][a-z0-9-]*$/;

export function envOf(args: Record<string, unknown>, key = 'env'): string {
  const env = text(args, key);
  if (env === undefined) throw new MfeflowError('E107', `--${key} <env> is required`);
  if (!ENV_NAME.test(env))
    throw new MfeflowError('E107', `--${key} "${env}" must be lowercase letters, digits and -`);
  return env;
}

export function positionals(args: Record<string, unknown>, max: number, usage: string): string[] {
  const given = Array.isArray(args._) ? args._.map(String) : [];
  const surplus = given[max];
  if (surplus !== undefined) throw new MfeflowError('E107', `unexpected "${surplus}" (${usage})`);
  return given;
}

export async function openSession(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: Globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive),
): Promise<Session> {
  const view = await inspectProject(await findProjectRoot(raw.cwd));
  const flag = text(args, 'host');
  const spec = flag ?? view.project.registry?.host;
  if (spec === undefined)
    throw new MfeflowError('E506', 'no host: pass --host or set registry.host in mfeflow.json');
  const parsed = parseHostSpec(spec, flag === undefined ? view.root : raw.cwd);
  const secrets = secretsOf(rt.io.env);
  let host: RegistryHost;
  try {
    host = openHost(parsed, {
      env: rt.io.env,
      ...(rt.hostFetch === undefined ? {} : { fetch: rt.hostFetch }),
    });
  } catch (error) {
    throw hostFailure(error, secrets);
  }
  const baseUrl = text(args, 'base-url') ?? view.project.registry?.baseUrl;
  return {
    rt,
    globals: raw,
    view,
    host: rt.wrapHost === undefined ? host : rt.wrapHost(host),
    hostLabel: describeHost(parsed),
    secrets,
    baseUrl: baseUrl?.replace(/\/+$/, ''),
  };
}

/** A failure from the host or the files around it as the catalogue error that names it. Secrets never reach the message. */
export function hostFailure(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof MfeflowError || error instanceof PreconditionFailedError) return error;
  const message = redact(messageOf(error), secrets);
  if (error instanceof HostError) {
    return new MfeflowError(message.includes('already published') ? 'E511' : 'E506', message);
  }
  if (error instanceof SyntaxError) return new MfeflowError('E506', `the index is ${message}`);
  return error instanceof Error ? error : new Error(message);
}

/** Runs host work, turning host errors into catalogue errors. */
export async function onHost<T>(s: Session, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw hostFailure(error, s.secrets);
  }
}

export function remoteApp(view: ProjectView, name: string | undefined): AppView & { mfe: MfeOk } {
  const remotes = view.apps.filter((a) => a.kind === 'remote');
  if (name === undefined)
    throw new MfeflowError(
      'E107',
      `name the remote (remotes: ${remotes.map((a) => a.name).join(', ')})`,
    );
  const app = remotes.find((a) => a.name === name);
  if (app === undefined)
    throw new MfeflowError(
      'E107',
      `"${name}" is not a remote of this project (remotes: ${remotes.map((a) => a.name).join(', ')})`,
    );
  if (app.mfe.state !== 'ok')
    throw new MfeflowError('E113', `${app.rel}/mfe.json is ${app.mfe.state}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed on the line above
  return app as AppView & { mfe: MfeOk };
}

type MfeOk = { state: 'ok'; value: MfeManifest };

/** The versions the shell has, for the packages a remote's compatibility is judged on. */
export async function shellVersions(
  view: ProjectView,
  mfe: MfeManifest,
): Promise<Record<string, string>> {
  const shells = view.apps.filter((a) => a.kind === 'shell' && a.present);
  const shell = shells.find((a) => mfe.shells.includes(a.name)) ?? shells[0];
  if (shell === undefined) return {};
  const out: Record<string, string> = {};
  for (const name of new Set([...Object.keys(mfe.platform ?? {}), ...SINGLETON_PACKAGES])) {
    // oxlint-disable-next-line no-await-in-loop -- a few packages
    const version = await versionIn(shell, name, view.root);
    if (version !== undefined) out[name] = version;
  }
  return out;
}

export const shellManifestKey = (env: string): string => `envs/${env}/shell/mf-manifest.json`;

/** The shell's deployed `mf-manifest.json`: the file given, else the one on the host under the env. */
export async function readShellManifest(
  s: Session,
  env: string,
  file: string | undefined,
): Promise<{ manifest?: unknown; warnings: string[] }> {
  try {
    if (file !== undefined) {
      const body = await fs.readFile(path.resolve(s.globals.cwd, file), 'utf8');
      return { manifest: JSON.parse(body), warnings: [] };
    }
    const stored = await onHost(s, () => s.host.get(shellManifestKey(env)));
    if (stored === undefined)
      return {
        warnings: [`no shell manifest at ${shellManifestKey(env)}; compat used workspace versions`],
      };
    return { manifest: JSON.parse(new TextDecoder().decode(stored.body)), warnings: [] };
  } catch (error) {
    if (error instanceof MfeflowError) throw error;
    return {
      warnings: [
        `the shell manifest could not be read (${messageOf(error)}); compat used workspace versions`,
      ],
    };
  }
}

export async function currentIndex(
  s: Session,
  env: string,
): Promise<{ index: RegistryIndex | undefined; etag?: string }> {
  return onHost(s, () => readIndex(s.host, env));
}

/** Where artifacts are served from: the setting, else read back from an entry already in the index. */
export function baseUrlFor(s: Session, index: RegistryIndex | undefined): string {
  if (s.baseUrl !== undefined) return s.baseUrl;
  for (const remote of index?.remotes ?? []) {
    const marker = `/${remote.name}/`;
    const at = remote.entry.lastIndexOf(marker);
    if (at > 0) return remote.entry.slice(0, at);
  }
  throw new MfeflowError(
    'E506',
    "no base URL: pass --base-url or set registry.baseUrl in mfeflow.json (where the host's files are served from)",
  );
}

export function describeUploads(plan: DeployPlan): PlannedUpload[] {
  return plan.uploads.map((u) => ({
    key: u.key,
    bytes: typeof u.body === 'string' ? new TextEncoder().encode(u.body).length : u.body.length,
    contentType: u.contentType,
    cacheControl: u.cacheControl,
    guard:
      u.ifMatch !== undefined ? 'if-match' : u.ifNoneMatch !== undefined ? 'create-only' : 'none',
  }));
}

export function gateFindings(plan: DeployPlan, app: string): Finding[] {
  return plan.failures.map((f) => finding('deploy.gates', GATE_CODES[f.code], f.message, { app }));
}

export interface Planned {
  plan: DeployPlan;
  /** The remote's entry in the index before this run. */
  before: RegistryIndexRemote | undefined;
  warnings: string[];
  /** The pointer already is where the command would move it. */
  noop?: boolean;
}

export interface Committed {
  planned: Planned;
  applied: ApplyResult | undefined;
  /** The index was written. */
  published: boolean;
}

export interface CommitOptions {
  env: string;
  name: string;
  dryRun: boolean;
  /** Upload the artifacts and leave the index where it is. */
  noPublish?: boolean;
  /** Reads the host and plans. Runs again after another writer got in first. */
  plan: () => Promise<Planned>;
}

function otherWriter(index: RegistryIndex | undefined, env: string, name: string): string {
  if (index === undefined) return `${indexKey(env)} was created by someone else`;
  const served = index.remotes.find((r) => r.name === name)?.version;
  const at = index.generatedAt === undefined ? '' : ` at ${index.generatedAt}`;
  return `${indexKey(env)} was rewritten${at} by another deploy${served === undefined ? '' : `; it now serves ${name}@${served}`}`;
}

/**
 * Plans and applies. When another writer moves the index between the read and the write, reads it
 * again, plans again and tries once more; a second collision stops with E510 naming what changed.
 */
export async function commit(s: Session, options: CommitOptions): Promise<Committed> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    // oxlint-disable-next-line no-await-in-loop -- the second pass depends on the first
    const planned = await onHost(s, options.plan);
    const { plan } = planned;
    if (plan.failures.length > 0 || options.dryRun || planned.noop === true)
      return { planned, applied: undefined, published: false };
    const toApply: DeployPlan =
      options.noPublish === true
        ? { ...plan, uploads: plan.uploads.filter((u) => u.key !== plan.indexKey) }
        : plan;
    try {
      // oxlint-disable-next-line no-await-in-loop -- see above
      const applied = await onHost(s, () => applyPlan(s.host, toApply));
      return { planned, applied, published: options.noPublish !== true };
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
      if (attempt < 2) continue;
      // oxlint-disable-next-line no-await-in-loop -- naming the writer, on the way out
      const now = await currentIndex(s, options.env).catch(() => undefined);
      throw new MfeflowError('E510', otherWriter(now?.index, options.env, options.name));
    }
  }
}

/** The entry `registry/envs/<env>/<name>.json` records for what the index serves. */
export function localEntryOf(remote: RegistryIndexRemote): RegistryEntry {
  return {
    version: remote.version ?? '',
    manifestUrl: remote.entry,
    ...(remote.remoteEntry === undefined ? {} : { remoteEntry: remote.remoteEntry }),
    ...(remote.type === undefined ? {} : { type: remote.type }),
    ...(remote.entryGlobalName === undefined ? {} : { entryGlobalName: remote.entryGlobalName }),
    ...(remote.exposes === undefined ? {} : { exposes: remote.exposes }),
    ...(remote.previous === undefined ? {} : { previous: remote.previous }),
    ...(remote.owner === undefined ? {} : { owner: remote.owner }),
  };
}

export async function writeLocalEntry(
  root: string,
  env: string,
  remote: RegistryIndexRemote,
): Promise<string> {
  const file = path.join(root, 'registry', 'envs', env, `${remote.name}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(localEntryOf(remote), null, 2)}\n`);
  return path.relative(root, file).split(path.sep).join('/');
}
