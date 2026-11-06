import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadProject, messageOf, isMfeflowError } from '@mfeflow/core';
import { z } from 'zod';
import { readPackageJson } from '../version';
import { runCli, type CliMain, type CliRun } from './capture';
import { explainCode, explainLog } from './errors';
import { hashTargets, PlanRefused, type PlanStore } from './plans';

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
): Promise<{ result: Obj } | { error: ToolOutput }> {
  return resultOf(await runCli(ctx.main, [...argv, '--json', '--cwd', cwd], cwd, ctx.env));
}

function pick(source: Obj, keys: readonly string[]): Obj {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

const hostField = z
  .string()
  .max(300)
  .refine((host) => /^file:[^\0]+$/.test(host) || /^s3:\/\/[^\s@?#]+$/.test(host), {
    message: 'file:<dir> or s3://<bucket>[/prefix], no credentials',
  })
  .optional();

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
              ? { ...concise, packageManager: project.packageManager, project }
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
          'Check singletons, compatibility, config and drift. Never fixes anything. With against, compare to a deployed shell (https URL of its manifest or registry index, or a file).',
        annotations: READ_NETWORK,
        shape: {
          against: z.string().optional().describe('Deployed shell: https URL or file path'),
        },
      },
      async (args) => {
        const against = args.against?.trim();
        if (against?.startsWith('-')) return problem('against must not start with a dash');
        const out = await cli(
          ctx,
          args.cwd,
          against ? ['doctor', '--against', against] : ['doctor'],
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
          'What each environment serves, the version before it, and drift. Reads the registry host in mfeflow.json.',
        annotations: READ_NETWORK,
        shape: {
          env: name.optional().describe('Only this environment'),
          host: hostField.describe('Registry host, default from mfeflow.json'),
        },
      },
      async (args) => {
        const out = await cli(ctx, args.cwd, [
          'status',
          ...(args.env ? ['--env', args.env] : []),
          ...(args.host ? ['--host', args.host] : []),
        ]);
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
    case 'add_feature':
      if (!args.features?.length) throw new PlanRefused('add_feature needs features');
      return ['add', ...args.features];
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
    dependencies: list('dependencies').length,
    scripts: list('scripts').length,
    warnings: plan.warnings,
  };
}

function writeTools(ctx: ToolContext): Tool[] {
  const list = z.array(name).max(30);
  return [
    defineTool(
      {
        name: 'mfeflow_plan',
        title: 'Plan a change',
        description:
          'Plan init, add_feature, add_remote or upgrade. Runs the command as a dry run and writes nothing. Returns plan_id, a summary and the diff; show the diff to the user, then call mfeflow_apply_plan. A plan lasts 10 minutes and is refused if a file it touches changed.',
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
        const paths = (Array.isArray(plan.changes) ? plan.changes : [])
          .filter(isObj)
          .map((change) => change.path)
          .filter((p): p is string => typeof p === 'string');
        const stored = ctx.plans.add({
          scope: 'local',
          cwd: args.cwd,
          argv: [...argv, '--yes'],
          hashes: await hashTargets(root, [...paths, 'mfeflow.json']),
        });
        return {
          data: {
            ok: true,
            plan_id: stored.id,
            expires_at: new Date(stored.expiresAt).toISOString(),
            command: `mfeflow ${argv.join(' ')}`,
            root,
            summary: planSummary(out.result, args.response_format === 'detailed'),
            diff: out.result.diff ?? '',
          },
        };
      },
    ),
    defineTool(
      {
        name: 'mfeflow_apply_plan',
        title: 'Apply a plan',
        description:
          'Write the files of a plan made by mfeflow_plan. Confirm with the user first. Refuses if the plan expired, was made for another cwd, or any file it touches changed. Does not install packages.',
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
        const out = await cli(ctx, args.cwd, plan.argv);
        if ('error' in out) return out.error;
        const detailed = args.response_format === 'detailed';
        return {
          isError: out.result.ok !== true,
          data: detailed
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
              ]),
        };
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
  host?: string | undefined;
}): string[] {
  const host = args.host ? ['--host', args.host] : [];
  if (args.kind === 'promote') {
    if (!args.from || !args.to) throw new PlanRefused('promote needs from and to (environments)');
    return ['promote', args.remote, '--from', args.from, '--to', args.to, ...host];
  }
  if (!args.env) throw new PlanRefused('rollback needs env');
  return [
    'rollback',
    args.remote,
    '--env',
    args.env,
    ...(args.version ? ['--to', args.version] : []),
    ...host,
  ];
}

function registryTools(ctx: ToolContext): Tool[] {
  return [
    defineTool(
      {
        name: 'mfeflow_registry_plan',
        title: 'Plan a promote or rollback',
        description:
          'Plan moving an environment to another version: promote (copy what one env serves to another) or rollback. Dry run only; nothing is uploaded or changed. Credentials come from the environment the server runs in, never from arguments. Returns plan_id.',
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
          host: hostField.describe('Registry host, default from mfeflow.json'),
        },
      },
      async (args) => {
        const argv = registryArgv(args);
        const out = await cli(ctx, args.cwd, [...argv, '--dry-run']);
        if ('error' in out) return out.error;
        const root = typeof out.result.root === 'string' ? out.result.root : args.cwd;
        const entry = typeof out.result.localEntry === 'string' ? [out.result.localEntry] : [];
        const stored = ctx.plans.add({
          scope: 'registry',
          cwd: args.cwd,
          argv: [...argv, '--yes'],
          hashes: await hashTargets(root, [...entry, 'mfeflow.json']),
        });
        return {
          isError: out.result.ok !== true,
          data: {
            plan_id: stored.id,
            expires_at: new Date(stored.expiresAt).toISOString(),
            command: `mfeflow ${argv.join(' ')}`,
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
          'Run a plan made by mfeflow_registry_plan against the registry host. Changes what visitors get. Confirm with the user first. Same refusals as mfeflow_apply_plan.',
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
