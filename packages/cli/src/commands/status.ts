import semver from 'semver';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals } from '../args';
import { finding, type Finding } from '../findings';
import type { ProjectView } from '../inspect';
import type { StatusEnv, StatusRemote, StatusResult } from '../output';
import { currentIndex, envOf, onHost, openSession, positionals, type Session } from '../publish';
import type { Runtime } from '../runtime';
import type { RegistryIndex, RegistryIndexRemote } from '@mfeflow/contracts';

export const STATUS_ARGS = {
  env: {
    type: 'string',
    description: 'Only this environment (default: every folder in registry/envs except dev)',
    valueHint: 'env',
  },
  host: {
    type: 'string',
    description:
      'Where the registry lives: file:<dir> or s3://<bucket>[/prefix] (default registry.host)',
    valueHint: 'spec',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const decodeVersion = (segment: string): string => segment.replaceAll('_', '+');

/** Every version any environment's index mentions for `name`: files are shared between environments. */
function mentioned(indexes: readonly RegistryIndex[], name: string): Set<string> {
  const out = new Set<string>();
  for (const index of indexes) {
    for (const remote of index.remotes.filter((r) => r.name === name)) {
      const all = [
        remote.version,
        remote.previous,
        remote.rolledBackFrom,
        ...(remote.history ?? []),
      ];
      for (const v of all) if (v !== undefined) out.add(v);
    }
  }
  return out;
}

/** Is `version` a candidate waiting to be deployed: newer than what is served? Older ones were left behind on purpose (a rollback, then a fix). */
function pendingOver(served: string | undefined, version: string): boolean {
  if (served === undefined || semver.valid(version) === null || semver.valid(served) === null)
    return true;
  return semver.compareBuild(version, served) > 0;
}

/** Versions on the host under `<name>/` that no index points at and that are newer than `served`. Null when the host cannot list. */
async function unreferenced(
  s: Session,
  name: string,
  served: string | undefined,
  indexes: readonly RegistryIndex[],
): Promise<string[] | null> {
  if (s.host.list === undefined) return null;
  const keys = await onHost(s, () => s.host.list?.(`${name}/`) ?? Promise.resolve([]));
  const tracked = mentioned(indexes, name);
  const found = new Set<string>();
  for (const key of keys) {
    const segment = key.split('/')[1];
    if (segment !== undefined && segment !== '') found.add(decodeVersion(segment));
  }
  return [...found].filter((v) => !tracked.has(v) && pendingOver(served, v)).toSorted();
}

function driftOf(
  view: ProjectView,
  env: string,
  remote: RegistryIndexRemote,
  extra: string[] | null,
): { local: string | null; drift: string[] } {
  const file = `registry/envs/${env}/${remote.name}.json`;
  const entry = view.registry[env]?.[remote.name];
  const drift: string[] = [];
  let local: string | null = null;
  if (entry === undefined)
    drift.push(`${file} is missing; the host serves ${String(remote.version)}`);
  else if (entry.state !== 'ok') drift.push(`${file} is ${entry.state}`);
  else {
    local = entry.value.version;
    if (local !== remote.version)
      drift.push(`${file} says ${local}, the host serves ${String(remote.version)}`);
    else if (entry.value.manifestUrl !== remote.entry)
      drift.push(`${file} points at ${entry.value.manifestUrl}, the host at ${remote.entry}`);
  }
  if (extra !== null && extra.length > 0)
    drift.push(
      `uploaded but not pointed at: ${extra.join(', ')} (deploy it, or it was uploaded with --no-publish)`,
    );
  return { local, drift };
}

async function envStatus(
  s: Session,
  env: string,
  all: ReadonlyMap<string, RegistryIndex>,
  findings: Finding[],
): Promise<StatusEnv> {
  const index = all.get(env);
  if (index === undefined) return { env, published: false, generatedAt: null, remotes: [] };
  const remotes: StatusRemote[] = [];
  for (const remote of index.remotes) {
    // oxlint-disable-next-line no-await-in-loop -- a few remotes
    const extra = await unreferenced(s, remote.name, remote.version, [...all.values()]);
    const { local, drift } = driftOf(s.view, env, remote, extra);
    for (const message of drift)
      findings.push(
        finding('status.drift', 'E512', message, { severity: 'warning', app: remote.name }),
      );
    remotes.push({
      name: remote.name,
      version: remote.version ?? '',
      previous: remote.previous ?? null,
      history: remote.history ?? [],
      rolledBackFrom: remote.rolledBackFrom ?? null,
      local,
      unreferenced: extra,
      drift,
    });
  }
  return { env, published: true, generatedAt: index.generatedAt ?? null, remotes };
}

export function formatStatus(result: StatusResult): string {
  const lines = [`Registry ${result.host}`];
  for (const e of result.envs) {
    lines.push('', e.env);
    if (!e.published) {
      lines.push('  nothing deployed yet');
      continue;
    }
    lines.push(`  index written ${e.generatedAt ?? 'at an unknown time'}`);
    for (const r of e.remotes) {
      const back = r.previous === null ? 'no previous' : `previous ${r.previous}`;
      const rolled = r.rolledBackFrom === null ? '' : `, rolled back from ${r.rolledBackFrom}`;
      lines.push(
        `  ${r.name}  ${r.version}  (${back}${rolled})${r.drift.length > 0 ? '  DRIFT' : ''}`,
      );
      for (const d of r.drift) lines.push(`    drift: ${d}`);
    }
  }
  if (result.findings.length > 0)
    lines.push('', 'Drift: see the lines marked above; fix it with deploy, promote or rollback.');
  return lines.join('\n');
}

export async function runStatus(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<StatusResult> {
  assertKnownFlags(raw, STATUS_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  positionals(args, 0, 'mfeflow status [--env <env>]');
  const s = await openSession(rt, args, globals);
  const envs = args.env === undefined ? s.view.envDirs.filter((e) => e !== 'dev') : [envOf(args)];
  const findings: Finding[] = [];
  const out: StatusEnv[] = [];
  const all = new Map<string, RegistryIndex>();
  for (const env of new Set([...envs, ...s.view.envDirs])) {
    // oxlint-disable-next-line no-await-in-loop -- a few envs
    const { index } = await currentIndex(s, env);
    if (index !== undefined) all.set(env, index);
  }
  for (const env of envs) {
    // oxlint-disable-next-line no-await-in-loop -- a few envs
    out.push(await envStatus(s, env, all, findings));
  }
  const result: StatusResult = {
    ok: true,
    command: 'status',
    root: s.view.root,
    host: s.hostLabel,
    envs: out,
    findings,
  };
  if (!globals.json) rt.io.stdout(formatStatus(result));
  return result;
}
