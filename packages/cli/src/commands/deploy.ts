import path from 'node:path';
import {
  remoteDistFiles,
  ROUTE_OVERLAP,
  validateRegistryIndex,
  type MfeManifest,
  type RegistryIndex,
  type RegistryIndexRemote,
} from '@mfeflow/contracts';
import { MfeflowError } from '@mfeflow/core';
import {
  artifactPrefix,
  INDEX_CACHE_CONTROL,
  planDeploy,
  type Upload,
} from '@mfeflow/registry/static';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, text } from '../args';
import { Cancelled } from '../exit';
import type { DeployResult } from '../output';
import {
  baseUrlFor,
  commit,
  currentIndex,
  describeUploads,
  envOf,
  gateFindings,
  openSession,
  positionals,
  readBuild,
  readShellManifest,
  remoteApp,
  shellVersions,
  writeLocalEntry,
  type Committed,
  type Build,
  type Planned,
  type Session,
} from '../publish';
import type { Runtime } from '../runtime';
import { openServer } from '../server-client';
import {
  deployViaServer,
  promoteViaServer,
  refuseRolloutFlags,
  rollbackViaServer,
  ROLLOUT_ARGS,
  SERVER_ARGS,
} from './server-mode';

const HOST_ARGS = {
  ...SERVER_ARGS,
  host: {
    type: 'string',
    description:
      'Where the registry lives: file:<dir> or s3://<bucket>[/prefix] (default registry.host)',
    valueHint: 'spec',
  },
  'base-url': {
    type: 'string',
    description: "Where the host's files are served from (default registry.baseUrl)",
    valueHint: 'url',
  },
  'shell-manifest': {
    type: 'string',
    description: "The shell's deployed mf-manifest.json (default envs/<env>/shell/ on the host)",
    valueHint: 'file',
  },
} as const satisfies ArgsDef;

export const DEPLOY_ARGS = {
  env: { type: 'string', description: 'Environment to deploy to', valueHint: 'env' },
  version: {
    type: 'string',
    description: "Version to publish (default: the remote's package.json version)",
    valueHint: 'v',
  },
  dist: {
    type: 'string',
    description: 'Build output folder inside the remote (default dist)',
    valueHint: 'dir',
  },
  publish: {
    type: 'boolean',
    default: true,
    description: 'Move the index to the new version (--no-publish uploads the files and stops)',
  },
  ...ROLLOUT_ARGS,
  ...HOST_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export const PROMOTE_ARGS = {
  from: { type: 'string', description: 'Environment to copy the version from', valueHint: 'env' },
  to: { type: 'string', description: 'Environment to point at it', valueHint: 'env' },
  ...ROLLOUT_ARGS,
  ...HOST_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export const ROLLBACK_ARGS = {
  env: { type: 'string', description: 'Environment to roll back', valueHint: 'env' },
  to: {
    type: 'string',
    description: 'Version to go back to (default: the previous one)',
    valueHint: 'v',
  },
  force: {
    type: 'boolean',
    description:
      'Roll back even if the schema, route or compatibility checks fail (the files must still exist)',
  },
  ...HOST_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

async function confirm(s: Session, message: string, dryRun: boolean): Promise<void> {
  if (dryRun || !s.globals.canPrompt) return;
  if (!(await s.rt.prompter.confirm({ message, initialValue: false }))) throw new Cancelled();
}

interface Facts {
  command: DeployResult['command'];
  env: string;
  fromEnv?: string;
  remote: string;
  version: string;
}

async function finish(s: Session, facts: Facts, done: Committed): Promise<DeployResult> {
  const { plan, before, warnings, noop } = done.planned;
  const after = plan.index.remotes.find((r) => r.name === facts.remote);
  const shown = noop === true ? before : after;
  const failed = plan.failures.length > 0;
  const dryRun = s.globals.dryRun;
  const moved = done.published && !failed;
  let localEntry: string | null = null;
  // registry/envs/dev is the registry `mfeflow dev` serves from; a CDN address there would break local dev.
  const local = facts.env !== 'dev';
  if (moved && local && after !== undefined)
    localEntry = await writeLocalEntry(s.view.root, facts.env, after);
  const notes =
    moved && !local ? ['registry/envs/dev was not written: `mfeflow dev` reads it'] : [];
  const result: DeployResult = {
    ok: !failed,
    command: facts.command,
    dryRun,
    root: s.view.root,
    env: facts.env,
    fromEnv: facts.fromEnv ?? null,
    host: s.hostLabel,
    remote: facts.remote,
    version: facts.version,
    servedBefore: before?.version ?? null,
    published: moved,
    previous: shown?.previous ?? null,
    rolledBackFrom: shown?.rolledBackFrom ?? null,
    uploads: failed ? [] : describeUploads(plan),
    uploaded: done.applied?.uploaded ?? [],
    skipped: done.applied?.skipped ?? [],
    localEntry,
    warnings: [...warnings, ...notes],
    findings: gateFindings(plan, facts.remote),
  };
  if (dryRun && !failed) result.index = plan.index;
  return result;
}

export function formatDeploy(result: DeployResult): string {
  const lines: string[] = [];
  const target = `${result.remote}@${result.version}`;
  const route =
    result.fromEnv === null ? `to ${result.env}` : `from ${result.fromEnv} to ${result.env}`;
  const verb = result.dryRun ? `Plan for ${result.command}` : result.command;
  lines.push(`${verb} ${target} ${route} (${result.host})`);
  for (const f of result.findings) {
    lines.push(`error ${f.code} ${f.message}`, `  Fix: ${f.fix}`, `  ${f.docs}`);
  }
  for (const w of result.warnings) lines.push(`warning ${w}`);
  if (!result.ok) {
    lines.push('Nothing was uploaded.');
    return lines.join('\n');
  }
  if (result.dryRun) {
    lines.push('Would upload, in order:');
    for (const u of result.uploads) lines.push(`  ${u.key} (${String(u.bytes)} bytes, ${u.guard})`);
    lines.push('Dry run: nothing was written.');
    return lines.join('\n');
  }
  const files = `${String(result.uploaded.length)} uploaded, ${String(result.skipped.length)} already there`;
  if (result.rollout !== undefined) {
    const r = result.rollout;
    const later =
      r.steps.length === 0 ? '' : `, then ${r.steps.map((n) => `${String(n)}%`).join(', ')}`;
    if (result.uploaded.length + result.skipped.length > 0) lines.push(`Files: ${files}`);
    lines.push(
      `Rollout started: ${target} is at ${String(r.percent)}%${later}. Everyone else stays on ${r.stable}.`,
      `Move it with mfeflow rollout step|complete|abort ${result.remote} --env ${result.env}.`,
    );
  } else if (result.published) {
    const was = result.servedBefore === null ? 'first deploy' : `was ${result.servedBefore}`;
    if (!result.host.startsWith('server ')) lines.push(`Files: ${files}`);
    lines.push(`${result.env} now serves ${target} (${was}).`);
    if (result.rolledBackFrom !== null) lines.push(`Rolled back from ${result.rolledBackFrom}.`);
    if (result.localEntry !== null) lines.push(`Wrote ${result.localEntry}.`);
  } else if (result.uploaded.length + result.skipped.length > 0) {
    lines.push(
      `Files: ${files}`,
      `The index was not changed; ${result.env} still serves ${result.servedBefore ?? 'nothing'}.`,
    );
  } else {
    lines.push(`${result.env} already serves ${target}. Nothing to do.`);
  }
  return lines.join('\n');
}

async function deployPlan(
  s: Session,
  mfe: MfeManifest,
  build: Build,
  version: string,
  env: string,
  shellFile: string | undefined,
): Promise<Planned> {
  const { index, etag } = await currentIndex(s, env);
  const shell = await readShellManifest(s, env, shellFile);
  const plan = planDeploy({
    remote: mfe,
    version,
    manifest: build.manifest,
    files: build.files,
    env,
    baseUrl: baseUrlFor(s, index),
    ...(index === undefined || etag === undefined
      ? {}
      : { currentIndex: index, currentIndexEtag: etag }),
    ...(shell.manifest === undefined ? {} : { shellManifest: shell.manifest }),
    workspaceVersions: await shellVersions(s.view, mfe),
  });
  return {
    plan,
    before: index?.remotes.find((r) => r.name === mfe.name),
    warnings: [...shell.warnings, ...plan.warnings],
  };
}

export async function runDeploy(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<DeployResult> {
  assertKnownFlags(raw, DEPLOY_ARGS);
  const server = openServer(rt, args);
  if (server !== undefined) {
    const result = await deployViaServer(rt, args, raw, DEPLOY_ARGS, server);
    if (args.json !== true) rt.io.stdout(formatDeploy(result));
    return result;
  }
  refuseRolloutFlags(args);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow deploy <remote> --env <env>');
  const env = envOf(args);
  const s = await openSession(rt, args, globals);
  const app = remoteApp(s.view, name);
  const version = text(args, 'version') ?? app.pkg?.version;
  if (version === undefined)
    throw new MfeflowError(
      'E507',
      `${app.name} has no version: pass --version or set one in its package.json`,
    );
  const dist = text(args, 'dist') ?? 'dist';
  const build = await readBuild(path.join(app.dir, dist), `${app.rel}/${dist}`);
  const noPublish = args.publish === false;
  await confirm(s, `Deploy ${app.name}@${version} to ${env} on ${s.hostLabel}?`, globals.dryRun);
  const done = await commit(s, {
    env,
    name: app.name,
    dryRun: globals.dryRun,
    noPublish,
    plan: () => deployPlan(s, app.mfe.value, build, version, env, text(args, 'shell-manifest')),
  });
  const result = await finish(s, { command: 'deploy', env, remote: app.name, version }, done);
  if (!globals.json) rt.io.stdout(formatDeploy(result));
  return result;
}

/** Reads the version's manifest from the host and checks, with HEAD, that its entry and expose files exist. */
async function versionManifest(s: Session, name: string, version: string): Promise<unknown> {
  const prefix = artifactPrefix(name, version);
  const missing = (what: string): MfeflowError =>
    new MfeflowError('E509', `${name}@${version}: ${what} (${prefix}/)`);
  const stored = await s.host.get(`${prefix}/mf-manifest.json`);
  if (stored === undefined) throw missing('mf-manifest.json is not on the host');
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(stored.body));
  } catch {
    throw missing('mf-manifest.json on the host is not valid JSON');
  }
  const dist = remoteDistFiles(manifest);
  if (dist === undefined) throw missing('mf-manifest.json has no usable remote entry');
  const wanted = [...new Set([dist.entry, ...Object.values(dist.exposes).flat()])];
  const gone: string[] = [];
  for (const file of wanted) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of files
    if ((await s.host.head(`${prefix}/${file}`)) === undefined) gone.push(file);
  }
  if (gone.length > 0)
    throw missing(
      `${gone.slice(0, 5).join(', ')}${gone.length > 5 ? ' and more' : ''} not on the host`,
    );
  return manifest;
}

interface MoveOptions {
  /** Looks at the remote as the freshly read index has it, and returns the entry to take routes and owner from. */
  guard?: (fresh: RegistryIndexRemote | undefined) => RegistryIndexRemote;
  /** Write the index although the schema, route or compatibility gates fail. Never skips the files check. */
  force?: boolean;
}

/**
 * Points `env` at a version already on the host. The version's files are checked to exist, but
 * nothing is uploaded: only the index moves. Its first-load size was judged when it was deployed,
 * so it is not judged again.
 */
async function movePlan(
  s: Session,
  app: { name: string; mfe: MfeManifest },
  version: string,
  env: string,
  source: RegistryIndexRemote,
  shellFile: string | undefined,
  options: MoveOptions = {},
): Promise<Planned> {
  const { index, etag } = await currentIndex(s, env);
  const before = index?.remotes.find((r) => r.name === app.name);
  const origin = options.guard?.(before) ?? source;
  if (before?.version === version)
    return {
      plan: {
        uploads: [],
        index: index ?? { remotes: [] },
        indexKey: '',
        failures: [],
        warnings: [],
      },
      before,
      warnings: [],
      noop: true,
    };
  const manifest = await versionManifest(s, app.name, version);
  const shell = await readShellManifest(s, env, shellFile);
  const mfe: MfeManifest = {
    ...app.mfe,
    routes: origin.routes ?? app.mfe.routes,
    owner: origin.owner ?? app.mfe.owner,
  };
  const plan = planDeploy({
    remote: mfe,
    version,
    manifest,
    files: {},
    env,
    baseUrl: baseUrlFor(s, { remotes: [origin, ...(index?.remotes ?? [])] }),
    ...(index === undefined || etag === undefined
      ? {}
      : { currentIndex: index, currentIndexEtag: etag }),
    ...(shell.manifest === undefined ? {} : { shellManifest: shell.manifest }),
    workspaceVersions: await shellVersions(s.view, mfe),
  });
  const warnings = [...shell.warnings, ...plan.warnings];
  // Size is not measured here (no files were read), so that gate's failure is not a verdict.
  const gates = plan.failures.filter((f) => f.code !== 'budget');
  const forced = options.force === true ? gates : [];
  const blocking = gates.filter((f) => !forced.includes(f));
  if (blocking.length > 0) return { plan: { ...plan, failures: blocking }, before, warnings };
  if (forced.length > 0) {
    const invalid = validateRegistryIndex(plan.index).filter((i) => i.code !== ROUTE_OVERLAP);
    if (invalid.length > 0)
      throw new MfeflowError(
        'E501',
        `even --force cannot write an invalid index: ${invalid.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      );
    warnings.push(
      `FORCED: --force skipped ${String(forced.length)} failed check(s); ${version} may not work with the shell that is deployed: ${forced.map((f) => f.message).join(' | ')}`,
    );
  }
  const indexUpload: Upload = {
    key: plan.indexKey,
    body: `${JSON.stringify(plan.index, null, 2)}\n`,
    contentType: 'application/json',
    cacheControl: INDEX_CACHE_CONTROL,
    ...(etag === undefined ? { ifNoneMatch: '*' as const } : { ifMatch: etag }),
  };
  return { plan: { ...plan, failures: [], uploads: [indexUpload] }, before, warnings };
}

function inEnv(index: RegistryIndex | undefined, name: string, env: string): RegistryIndexRemote {
  const remote = index?.remotes.find((r) => r.name === name);
  if (remote?.version === undefined)
    throw new MfeflowError('E508', `${name} is not deployed to ${env}`);
  return remote;
}

export async function runPromote(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<DeployResult> {
  assertKnownFlags(raw, PROMOTE_ARGS);
  const server = openServer(rt, args);
  if (server !== undefined) {
    const result = await promoteViaServer(rt, args, raw, PROMOTE_ARGS, server);
    if (args.json !== true) rt.io.stdout(formatDeploy(result));
    return result;
  }
  refuseRolloutFlags(args);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow promote <remote> --from <env> --to <env>');
  const from = envOf(args, 'from');
  const to = envOf(args, 'to');
  if (from === to) throw new MfeflowError('E107', `--from and --to are both "${from}"`);
  const s = await openSession(rt, args, globals);
  const app = remoteApp(s.view, name);
  const source = inEnv((await currentIndex(s, from)).index, app.name, from);
  const version = source.version ?? '';
  await confirm(
    s,
    `Point ${to} at ${app.name}@${version} (now in ${from}) on ${s.hostLabel}?`,
    globals.dryRun,
  );
  const done = await commit(s, {
    env: to,
    name: app.name,
    dryRun: globals.dryRun,
    plan: async () => {
      // Both indexes are read on every pass: the source may have moved while the target write was refused.
      const nowSource = inEnv((await currentIndex(s, from)).index, app.name, from);
      if (nowSource.version !== version)
        throw new MfeflowError(
          'E510',
          `${from} now serves ${app.name}@${String(nowSource.version)}, not ${version} as when this promote started; check \`mfeflow status\` and run it again`,
        );
      return movePlan(
        s,
        { name: app.name, mfe: app.mfe.value },
        version,
        to,
        nowSource,
        text(args, 'shell-manifest'),
      );
    },
  });
  const result = await finish(
    s,
    { command: 'promote', env: to, fromEnv: from, remote: app.name, version },
    done,
  );
  if (!globals.json) rt.io.stdout(formatDeploy(result));
  return result;
}

export async function runRollback(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<DeployResult> {
  assertKnownFlags(raw, ROLLBACK_ARGS);
  const server = openServer(rt, args);
  if (server !== undefined) {
    const result = await rollbackViaServer(rt, args, raw, ROLLBACK_ARGS, server);
    if (args.json !== true) rt.io.stdout(formatDeploy(result));
    return result;
  }
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow rollback <remote> --env <env>');
  const env = envOf(args);
  const s = await openSession(rt, args, globals);
  const app = remoteApp(s.view, name);
  const explicit = text(args, 'to');
  const target = (remote: RegistryIndexRemote): string => {
    const known = [...new Set([remote.previous, ...(remote.history ?? [])])].filter(
      (v): v is string => v !== undefined,
    );
    const to = explicit ?? remote.previous;
    if (to === undefined)
      throw new MfeflowError('E508', `${app.name} in ${env} has no previous version to go back to`);
    if (to === remote.version)
      throw new MfeflowError('E508', `${env} already serves ${app.name}@${to}`);
    if (!known.includes(to))
      throw new MfeflowError(
        'E508',
        `${app.name}@${to} is not in the history of ${env} (${known.length === 0 ? 'empty' : known.join(', ')})`,
      );
    return to;
  };
  const current = inEnv((await currentIndex(s, env)).index, app.name, env);
  const to = target(current);
  await confirm(
    s,
    `Roll ${env} back from ${app.name}@${current.version ?? ''} to ${to} on ${s.hostLabel}?`,
    globals.dryRun,
  );
  const done = await commit(s, {
    env,
    name: app.name,
    dryRun: globals.dryRun,
    plan: () =>
      movePlan(
        s,
        { name: app.name, mfe: app.mfe.value },
        to,
        env,
        current,
        text(args, 'shell-manifest'),
        {
          force: args.force === true,
          // A second pass runs on the index another writer just left: the intent is checked against it, not replayed.
          guard: (fresh) => {
            const now = inEnv(
              fresh === undefined ? undefined : { remotes: [fresh] },
              app.name,
              env,
            );
            if (explicit === undefined && now.version !== current.version)
              throw new MfeflowError(
                'E510',
                `${env} now serves ${app.name}@${String(now.version)}, not ${String(current.version)} as when this rollback started; check \`mfeflow status\` and run it again`,
              );
            target(now);
            return now;
          },
        },
      ),
  });
  const result = await finish(s, { command: 'rollback', env, remote: app.name, version: to }, done);
  if (!globals.json) rt.io.stdout(formatDeploy(result));
  return result;
}
