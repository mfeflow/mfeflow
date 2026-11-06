import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateHost, redactUrl, shellSourceProblem } from '@mfeflow/contracts';
import {
  findProjectRoot,
  loadProject,
  messageOf,
  isMfeflowError,
  MfeflowError,
} from '@mfeflow/core';
import { z } from 'zod';
import { readPackageJson } from '../version';
import { runCli, type CliMain, type CliRun } from './capture';
import { explainCode, explainLog } from './errors';
import { hashTargets, pageCount, pageOf, PlanRefused, type PlanStore } from './plans';

export interface ToolOutput {
  data: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  annotations: ToolAnnotations;
  run(raw: unknown): Promise<ToolOutput>;
}

export interface ToolContext {
  main: CliMain;
  plans: PlanStore;
  env: Readonly<Record<string, string | undefined>>;
}

const cwdField = z
  .string()
  .describe('Absolute path of the project folder (or any folder inside it)');
const formatField = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe('concise (default) keeps the answer short; detailed returns everything');

/** A name that cannot be read as a flag or leave the folder. */
const name = z.string().regex(/^[A-Za-z0-9@][A-Za-z0-9._/@-]*$/, 'letters, digits, . _ - / @ only');
const folder = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'one folder name, no slashes');

interface Common {
  cwd: string;
  response_format: 'concise' | 'detailed';
}

function defineTool<S extends z.ZodRawShape>(
  spec: Omit<Tool, 'shape' | 'run'> & { shape: S },
  handler: (args: z.infer<z.ZodObject<S>> & Common) => Promise<ToolOutput>,
): Tool {
  const common = z.object({ cwd: cwdField, response_format: formatField });
  const own = z.object(spec.shape);
  return {
    ...spec,
    shape: { ...common.shape, ...spec.shape },
    run: async (raw) => {
      const args = { ...own.parse(raw), ...common.parse(raw) };
      const failed = await checkCwd(args.cwd);
      if (failed) return failed;
      try {
        return await handler(args);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

async function checkCwd(cwd: string): Promise<ToolOutput | undefined> {
  if (!path.isAbsolute(cwd)) return problem('cwd must be an absolute path', cwd);
  try {
    if (!(await fs.stat(cwd)).isDirectory()) return problem('cwd is not a folder', cwd);
  } catch {
    return problem('cwd does not exist', cwd);
  }
  return undefined;
}

function problem(message: string, cwd?: string): ToolOutput {
  return { isError: true, data: { ok: false, error: { message, ...(cwd ? { cwd } : {}) } } };
}

function fail(error: unknown): ToolOutput {
  if (error instanceof PlanRefused) return problem(error.message);
  if (isMfeflowError(error)) {
    return {
      isError: true,
      data: {
        ok: false,
        error: { code: error.code, message: error.message, fix: error.fix, docs: error.docs },
      },
    };
  }
  return problem(messageOf(error));
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The CLI's `--json` document, or the error it printed instead of one. */
function resultOf(run: CliRun): { result: Obj } | { error: ToolOutput } {
  if (!isObj(run.json)) {
    const tail = (run.stderr || run.stdout).trim().slice(-2000);
    return { error: problem(`mfeflow printed no JSON (exit ${String(run.code)}): ${tail}`) };
  }
  if (run.json.ok === false && !('command' in run.json)) {
    return { error: { isError: true, data: run.json } };
  }
  return { result: run.json };
}

async function cli(
  ctx: ToolContext,
  cwd: string,
  argv: readonly string[],
  guardFetch?: (url: string) => void,
): Promise<{ result: Obj } | { error: ToolOutput }> {
  return resultOf(
    await runCli(ctx.main, [...argv, '--json', '--cwd', cwd], cwd, ctx.env, guardFetch),
  );
}

function pick(source: Obj, keys: readonly string[]): Obj {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

/**
 * The registry host the project names. The tools take no host argument, so an agent cannot point a
 * promote or rollback at a bucket of its choosing.
 */
async function configuredHost(cwd: string): Promise<string> {
  const project = await loadProject(await findProjectRoot(cwd));
  const option = project.features['registry-static']?.options?.host;
  const host =
    project.registry?.host ?? (typeof option === 'string' && option !== '' ? option : '');
  if (host === '') {
    throw new MfeflowError(
      'E506',
      'no registry host is configured: set registry.host in mfeflow.json. These tools use only the configured host and take no host argument.',
    );
  }
  return host;
}

const refusePrivateUrl = (url: string): void => {
  if (isPrivateHost(new URL(url).hostname)) {
    throw new MfeflowError('E405', `${redactUrl(url)} is a loopback or private address`);
  }
};

/**
 * `against` is treated like a shell address read from a committed file: no credentials, no
 * loopback or private host, and a file only from inside the project folder.
 */
async function checkedAgainst(cwd: string, value: string): Promise<string> {
  if (value.startsWith('-')) throw new PlanRefused('against must not start with a dash');
  const why = shellSourceProblem(value);
  if (why !== undefined) throw new PlanRefused(`against ${why}`);
  if (/^https?:\/\//i.test(value)) {
    refusePrivateUrl(value);
    return value;
  }
  const file = value.toLowerCase().startsWith('file:') ? fileURLToPath(value) : value;
  const home = await fs.realpath(cwd);
  const inside = async (candidate: string): Promise<string> => {
    const real = await fs.realpath(path.resolve(cwd, candidate)).catch(() => {
      throw new PlanRefused(`against ${candidate} does not exist`);
    });
    const rel = path.relative(home, real);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new PlanRefused('against may only name a file inside the project folder');
    }
    return real;
  };
  const real = await inside(file);
  const beside = path.join(path.dirname(real), 'mf-manifest.json');
  if (
    await fs.stat(beside).then(
      () => true,
      () => false,
    )
  )
    await inside(beside);
  return real;
}

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const READ_NETWORK = { ...READ, openWorldHint: true } as const;

function report(result: Obj, detailed: boolean): Obj {
  return detailed
    ? result
    : pick(result, ['ok', 'command', 'root', 'summary', 'against', 'findings']);
}

function redactedProject(project: Awaited<ReturnType<typeof loadProject>>): Obj {
  const registries = project.registries
    ? Object.fromEntries(
        Object.entries(project.registries).map(([ns, url]) => [ns, redactUrl(url)]),
      )
    : undefined;
  const registry = project.registry
    ? Object.fromEntries(
        Object.entries(project.registry).map(([key, value]) => [
          key,
          typeof value === 'string' ? redactUrl(value) : value,
        ]),
      )
    : undefined;
  return {
    ...project,
    ...(registries ? { registries } : {}),
    ...(registry ? { registry } : {}),
    ...(project.shell === undefined ? {} : { shell: redactUrl(project.shell) }),
  };
}

function readTools(ctx: ToolContext): Tool[] {
  return [
    defineTool(
      {
        name: 'mfeflow_inspect_project',
        title: 'Inspect an mfeflow project',
        description:
          'Read mfeflow.json: apps, features and their versions, topology, repo kind and bundler. Start here.',
        annotations: READ,
        shape: {},
      },
      async (args) => {
        const root = await findProjectRoot(args.cwd);
        const project = await loadProject(root);
        const concise = {
          ok: true,
          root,
          cli: project.cli ?? null,
          runningCli: readPackageJson().version,
          topology: project.topology,
          kind: project.repo ?? 'app',
          bundler: project.bundler ?? 'rsbuild',
          scope: project.scope,
          apps: Object.entries(project.apps).map(([appName, app]) => ({
            name: appName,
            kind: app.kind,
            path: app.path,
            port: app.port ?? null,
          })),
          features: Object.entries(project.features).map(([feature, entry]) => ({
            name: feature,
            version: entry.version,
          })),
        };
        return {
          data:
            args.response_format === 'detailed'
              ? {
                  ...concise,
                  packageManager: project.packageManager,
                  project: redactedProject(project),
                }
              : concise,
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_search_features',
        title: 'Search features',
        description:
          'List the features you can add, from mfeflow and the registries in mfeflow.json. Optional search text.',
        annotations: READ_NETWORK,
        shape: { query: z.string().optional().describe('Match name, description or keywords') },
      },
      async (args) => {
        const query = args.query?.trim();
        if (query?.startsWith('-')) return problem('query must not start with a dash');
        const out = await cli(ctx, args.cwd, query ? ['features', query] : ['features']);
        if ('error' in out) return out.error;
        if (args.response_format === 'detailed') return { data: out.result };
        const features = Array.isArray(out.result.features) ? out.result.features : [];
        return {
          data: {
            ok: out.result.ok,
            search: out.result.search,
            features: features
              .filter(isObj)
              .map((f) => pick(f, ['name', 'source', 'version', 'description', 'installed'])),
            registries: out.result.registries,
          },
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_validate',
        title: 'Validate the project',
        description:
          'Check mfeflow.json, every mfeflow.app.json and every registry entry against their schemas.',
        annotations: READ,
        shape: {},
      },
      async (args) => {
        const out = await cli(ctx, args.cwd, ['validate']);
        return 'error' in out
          ? out.error
          : { data: report(out.result, args.response_format === 'detailed') };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_doctor',
        title: 'Run doctor',
        description:
          'Check singletons, compatibility, config and drift. Never fixes anything. With against, compare to a deployed shell (public https URL of its manifest or registry index, or a file inside the project).',
        annotations: READ_NETWORK,
        shape: {
          against: z
            .string()
            .optional()
            .describe('Deployed shell: public https URL, or a file inside the project folder'),
        },
      },
      async (args) => {
        const against = args.against?.trim();
        const checked = against ? await checkedAgainst(args.cwd, against) : undefined;
        const out = await cli(
          ctx,
          args.cwd,
          checked ? ['doctor', '--against', checked] : ['doctor'],
          refusePrivateUrl,
        );
        return 'error' in out
          ? out.error
          : { data: report(out.result, args.response_format === 'detailed') };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_registry_status',
        title: 'Registry status',
        description:
          'What each environment serves, the version before it, and drift. Reads only the registry host set in mfeflow.json.',
        annotations: READ_NETWORK,
        shape: {
          env: name.optional().describe('Only this environment'),
        },
      },
      async (args) => {
        await configuredHost(args.cwd);
        const out = await cli(ctx, args.cwd, ['status', ...(args.env ? ['--env', args.env] : [])]);
        if ('error' in out) return out.error;
        return {
          data:
            args.response_format === 'detailed'
              ? out.result
              : pick(out.result, ['ok', 'root', 'host', 'envs', 'findings']),
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_explain_error',
        title: 'Explain an error',
        description:
          'Explain an MFEFLOW_Exxx code (title, fix, docs link), or find every code in a pasted log.',
        annotations: READ,
        shape: {
          code: z.string().max(20).optional().describe('For example MFEFLOW_E101 or E101'),
          log: z.string().max(200_000).optional().describe('Pasted output that contains codes'),
        },
      },
      async (args) => {
        if (args.code === undefined && args.log === undefined) {
          return problem('give a code or a log');
        }
        const errors = [];
        const unknown: string[] = [];
        if (args.code !== undefined) {
          const one = explainCode(args.code);
          if (one) errors.push(one);
          else unknown.push(args.code);
        }
        if (args.log !== undefined) {
          const found = explainLog(args.log);
          for (const item of found.found) {
            if (!errors.some((e) => e.code === item.code)) errors.push(item);
          }
          unknown.push(...found.unknown);
        }
        return { data: { ok: errors.length > 0, errors, unknown } };
      },
    ),
  ];
}

const PLAN_KINDS = ['init', 'add_feature', 'add_remote', 'upgrade'] as const;

/** First words `mfeflow add` reads as a subcommand instead of a feature name. */
const ADD_SUBCOMMANDS = ['remote', 'shell', 'env-key', 'team-repo'];

function planArgv(args: {
  kind: (typeof PLAN_KINDS)[number];
  name?: string | undefined;
  features?: string[] | undefined;
  remotes?: string[] | undefined;
  scope?: string | undefined;
  topology?: 'monorepo' | 'polyrepo' | undefined;
  bundler?: 'rsbuild' | 'vite' | undefined;
  port?: number | undefined;
}): string[] {
  const need = (value: string | undefined, label: string): string => {
    if (value === undefined) throw new PlanRefused(`${args.kind} needs ${label}`);
    return value;
  };
  switch (args.kind) {
    case 'init':
      return [
        'init',
        need(args.name, 'name (the folder to create)'),
        ...(args.scope ? ['--scope', args.scope] : []),
        ...(args.remotes ? ['--remotes', args.remotes.join(',')] : []),
        ...(args.features ? ['--features', args.features.join(',')] : []),
        ...(args.topology ? ['--topology', args.topology] : []),
        ...(args.bundler ? ['--bundler', args.bundler] : []),
      ];
    case 'add_feature': {
      if (!args.features?.length) throw new PlanRefused('add_feature needs features');
      const reserved = args.features.find((f) => ADD_SUBCOMMANDS.includes(f.toLowerCase()));
      if (reserved !== undefined) {
        throw new PlanRefused(
          `"${reserved}" is a subcommand of mfeflow add, not a feature name; use kind add_remote to add a remote. ${ADD_SUBCOMMANDS.join(', ')} are not features.`,
        );
      }
      return ['add', ...args.features];
    }
    case 'add_remote':
      return [
        'add',
        'remote',
        need(args.name, 'name (the remote)'),
        ...(args.port === undefined ? [] : ['--port', String(args.port)]),
      ];
    case 'upgrade':
      break;
  }
  return ['upgrade'];
}

function planSummary(result: Obj, detailed: boolean): Obj {
  const plan = isObj(result.plan) ? result.plan : {};
  if (detailed) return plan;
  const list = (key: string): unknown[] => (Array.isArray(plan[key]) ? plan[key] : []);
  return {
    features: plan.features,
    changes: plan.changes,
    changes_count: list('changes').length,
    dependencies: list('dependencies').length,
    scripts: list('scripts').length,
    warnings: plan.warnings,
  };
}

/** Every path a plan names, including the ones it would skip. */
function planPaths(plan: Obj): string[] {
  const named = (key: string): string[] =>
    (Array.isArray(plan[key]) ? plan[key] : []).flatMap((item): string[] => {
      if (typeof item === 'string') return [item];
      return isObj(item) && typeof item.path === 'string' ? [item.path] : [];
    });
  return [...named('changes'), ...named('skipped')];
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** What a dry run of a feature add would write; if it differs at apply, the registry changed. */
function changeFingerprint(result: Obj): string {
  const plan = isObj(result.plan) ? result.plan : {};
  const changes = (Array.isArray(plan.changes) ? plan.changes : []).filter(isObj);
  return sha(
    JSON.stringify({
      changes: changes.map((c) => [c.path, c.action]),
      diff: sha(typeof result.diff === 'string' ? result.diff : ''),
    }),
  );
}

const WRITTEN_SHOWN = 200;

/** `written` with its count, and how many are not listed, so a long list is never cut unseen. */
function withWrittenCount(result: Obj): Obj {
  if (!Array.isArray(result.written)) return result;
  const total = result.written.length;
  return {
    ...result,
    written: result.written.slice(0, WRITTEN_SHOWN),
    written_count: total,
    ...(total > WRITTEN_SHOWN ? { written_omitted: total - WRITTEN_SHOWN } : {}),
  };
}

/** Runs a plan's stored dry run again and refuses the apply if the outcome moved. */
async function stillSame(
  ctx: ToolContext,
  cwd: string,
  plan: { verify?: { argv: string[]; fingerprint: string } | undefined },
  fingerprint: (result: Obj) => string,
): Promise<ToolOutput | undefined> {
  if (!plan.verify) return undefined;
  const out = await cli(ctx, cwd, plan.verify.argv);
  if ('error' in out) return out.error;
  if (out.result.ok !== true || fingerprint(out.result) !== plan.verify.fingerprint) {
    throw new PlanRefused(
      'what this plan would do is no longer what was planned (the registry or the host changed); make a new plan',
    );
  }
  return undefined;
}

function writeTools(ctx: ToolContext): Tool[] {
  const list = z.array(name).max(30);
  return [
    defineTool(
      {
        name: 'mfeflow_plan',
        title: 'Plan a change',
        description:
          'Plan init, add_feature, add_remote or upgrade. Runs the command as a dry run and writes nothing. Returns plan_id, a summary and the diff; a long diff comes in pages (diff_pages), read the rest with mfeflow_plan_diff. Show the whole diff to the user, then call mfeflow_apply_plan. A plan lasts 10 minutes and is refused if a file it touches changed.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        shape: {
          kind: z.enum(PLAN_KINDS),
          name: folder
            .optional()
            .describe('init: the folder to create. add_remote: the remote name'),
          features: list.optional().describe('add_feature (required) or init: feature names'),
          remotes: list.optional().describe('init: remotes to create'),
          scope: z
            .string()
            .regex(/^@[a-z0-9][a-z0-9-._]*$/)
            .optional()
            .describe('init: npm scope'),
          topology: z.enum(['monorepo', 'polyrepo']).optional().describe('init only'),
          bundler: z.enum(['rsbuild', 'vite']).optional().describe('init only'),
          port: z.number().int().min(1024).max(65535).optional().describe('add_remote: dev port'),
        },
      },
      async (args) => {
        const argv = [...planArgv(args), '--no-install'];
        const out = await cli(ctx, args.cwd, [...argv, '--dry-run']);
        if ('error' in out) return out.error;
        if (out.result.ok !== true) return { isError: true, data: out.result };
        const root = typeof out.result.root === 'string' ? out.result.root : args.cwd;
        const plan = isObj(out.result.plan) ? out.result.plan : {};
        const diff = typeof out.result.diff === 'string' ? out.result.diff : '';
        const stored = ctx.plans.add({
          scope: 'local',
          cwd: args.cwd,
          argv: [...argv, '--yes'],
          hashes: await hashTargets(root, [...planPaths(plan), 'mfeflow.json']),
          diff,
          ...(args.kind === 'add_feature'
            ? {
                verify: {
                  argv: [...argv, '--dry-run'],
                  fingerprint: changeFingerprint(out.result),
                },
              }
            : {}),
        });
        const pages = pageCount(diff);
        return {
          data: {
            ok: true,
            plan_id: stored.id,
            expires_at: new Date(stored.expiresAt).toISOString(),
            command: `mfeflow ${argv.join(' ')}`,
            root,
            summary: planSummary(out.result, args.response_format === 'detailed'),
            diff: pageOf(diff, 1),
            diff_page: 1,
            diff_pages: pages,
            ...(pages > 1
              ? {
                  diff_note: `The diff is cut: this is page 1 of ${String(pages)}. Read the rest with mfeflow_plan_diff (plan_id, page) and show the user all of it before applying.`,
                }
              : {}),
          },
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_plan_diff',
        title: 'Read a plan diff',
        description:
          'Read the diff of a plan made by mfeflow_plan, one page at a time. Writes nothing and does not use up the plan.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        shape: {
          plan_id: z.string().uuid(),
          page: z.number().int().min(1).default(1).describe('Page number, from 1'),
        },
      },
      (args) => {
        const plan = ctx.plans.peek(args.plan_id, 'local', args.cwd);
        const diff = plan.diff ?? '';
        const pages = pageCount(diff);
        if (args.page > pages) {
          return Promise.resolve(
            problem(`the diff has ${String(pages)} page(s); no page ${String(args.page)}`),
          );
        }
        return Promise.resolve({
          data: {
            ok: true,
            plan_id: plan.id,
            diff_page: args.page,
            diff_pages: pages,
            diff: pageOf(diff, args.page),
            ...(args.page < pages ? { next_page: args.page + 1 } : {}),
          },
        });
      },
    ),
    defineTool(
      {
        name: 'mfeflow_apply_plan',
        title: 'Apply a plan',
        description:
          'Write the files of a plan made by mfeflow_plan. Confirm with the user first; the plan_id is not a permission, anyone who has it can apply. Refuses if the plan expired, was made for another cwd, any file it touches changed, or a registry feature now gives a different result. Does not install packages.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
        shape: { plan_id: z.string().uuid() },
      },
      async (args) => {
        const plan = await ctx.plans.take(args.plan_id, 'local', args.cwd);
        const moved = await stillSame(ctx, args.cwd, plan, changeFingerprint);
        if (moved) return moved;
        const out = await cli(ctx, args.cwd, plan.argv);
        if ('error' in out) return out.error;
        const detailed = args.response_format === 'detailed';
        const shown = detailed
          ? out.result
          : pick(out.result, [
              'ok',
              'command',
              'root',
              'written',
              'added',
              'skipped',
              'installed',
              'next',
            ]);
        return { isError: out.result.ok !== true, data: withWrittenCount(shown) };
      },
    ),
  ];
}

const REGISTRY_KINDS = ['promote', 'rollback'] as const;
function registryArgv(args: {
  kind: (typeof REGISTRY_KINDS)[number];
  remote: string;
  env?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  version?: string | undefined;
}): string[] {
  if (args.kind === 'promote') {
    if (!args.from || !args.to) throw new PlanRefused('promote needs from and to (environments)');
    return ['promote', args.remote, '--from', args.from, '--to', args.to];
  }
  if (!args.env) throw new PlanRefused('rollback needs env');
  return [
    'rollback',
    args.remote,
    '--env',
    args.env,
    ...(args.version ? ['--to', args.version] : []),
  ];
}

/** What a promote or rollback would do right now: the version moved and what the env serves. */
function moveFingerprint(result: Obj): string {
  return JSON.stringify([
    result.env,
    result.fromEnv,
    result.remote,
    result.version,
    result.servedBefore,
  ]);
}

function registryTools(ctx: ToolContext): Tool[] {
  return [
    defineTool(
      {
        name: 'mfeflow_registry_plan',
        title: 'Plan a promote or rollback',
        description:
          'Plan moving an environment to another version: promote (copy what one env serves to another) or rollback. Dry run only; nothing is uploaded or changed. Uses only the registry.host in mfeflow.json and takes no host argument. Credentials come from the environment the server runs in, never from arguments. The plan pins the version and what each environment serves, and apply is refused if either moved. Returns plan_id.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        shape: {
          kind: z.enum(REGISTRY_KINDS),
          remote: name,
          env: name.optional().describe('rollback: the environment'),
          from: name.optional().describe('promote: source environment'),
          to: name.optional().describe('promote: target environment'),
          version: z
            .string()
            .regex(/^[0-9][A-Za-z0-9.+-]*$/)
            .optional()
            .describe('rollback: version to return to'),
        },
      },
      async (args) => {
        await configuredHost(args.cwd);
        const argv = registryArgv(args);
        const out = await cli(ctx, args.cwd, [...argv, '--dry-run']);
        if ('error' in out) return out.error;
        if (out.result.ok !== true) return { isError: true, data: out.result };
        const pinned =
          args.kind === 'rollback' && !args.version && typeof out.result.version === 'string'
            ? [...argv, '--to', out.result.version]
            : argv;
        const root = typeof out.result.root === 'string' ? out.result.root : args.cwd;
        const entry = typeof out.result.localEntry === 'string' ? [out.result.localEntry] : [];
        const stored = ctx.plans.add({
          scope: 'registry',
          cwd: args.cwd,
          argv: [...pinned, '--yes'],
          hashes: await hashTargets(root, [...entry, 'mfeflow.json']),
          verify: { argv: [...pinned, '--dry-run'], fingerprint: moveFingerprint(out.result) },
        });
        return {
          data: {
            plan_id: stored.id,
            expires_at: new Date(stored.expiresAt).toISOString(),
            command: `mfeflow ${pinned.join(' ')}`,
            ...(args.response_format === 'detailed'
              ? out.result
              : pick(out.result, [
                  'ok',
                  'env',
                  'fromEnv',
                  'host',
                  'remote',
                  'version',
                  'servedBefore',
                  'warnings',
                  'findings',
                ])),
          },
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_registry_apply',
        title: 'Apply a promote or rollback',
        description:
          'Run a plan made by mfeflow_registry_plan against the registry host in mfeflow.json. Changes what visitors get. Confirm with the user first; the plan_id is not a permission. Refuses if what the environments serve changed since the plan, and on the same refusals as mfeflow_apply_plan.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
        shape: { plan_id: z.string().uuid() },
      },
      async (args) => {
        const plan = await ctx.plans.take(args.plan_id, 'registry', args.cwd);
        await configuredHost(args.cwd);
        const moved = await stillSame(ctx, args.cwd, plan, moveFingerprint);
        if (moved) return moved;
        const out = await cli(ctx, args.cwd, plan.argv);
        if ('error' in out) return out.error;
        return {
          isError: out.result.ok !== true,
          data:
            args.response_format === 'detailed'
              ? out.result
              : pick(out.result, [
                  'ok',
                  'command',
                  'env',
                  'remote',
                  'version',
                  'published',
                  'previous',
                  'rolledBackFrom',
                  'findings',
                ]),
        };
      },
    ),
  ];
}

export function buildTools(ctx: ToolContext, allowRegistryWrites: boolean): Tool[] {
  return [
    ...readTools(ctx),
    ...writeTools(ctx),
    ...(allowRegistryWrites ? registryTools(ctx) : []),
  ];
}
