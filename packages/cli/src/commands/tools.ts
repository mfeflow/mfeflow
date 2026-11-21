import path from 'node:path';
import { findProjectRoot, MfeflowError } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, splitList } from '../args';
import { inspectProject, readText, type AppView, type ProjectView } from '../inspect';
import type { ToolResult } from '../output';
import { realDevHost } from '../proc';
import type { Runtime } from '../runtime';
import { resolveTool, runTargets, TOOL_PACKAGE, type Target, type ToolName } from '../tools';

export const DEFAULT_JOBS = 4;

const ONLY_ARG = {
  only: {
    type: 'string',
    description: 'Run only for these apps, comma separated (default: every app)',
    valueHint: 'a,b',
  },
} as const satisfies ArgsDef;

export const TEST_ARGS = { ...ONLY_ARG, ...GLOBAL_ARGS } as const satisfies ArgsDef;
export const LINT_ARGS = { ...ONLY_ARG, ...GLOBAL_ARGS } as const satisfies ArgsDef;
export const TYPECHECK_ARGS = {
  only: {
    type: 'string',
    description: 'Check only these apps or packages, comma separated (default: all of them)',
    valueHint: 'a,b',
  },
  jobs: {
    type: 'string',
    description: `How many to check at once (default ${String(DEFAULT_JOBS)})`,
    valueHint: 'n',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

/** A folder the tools act on: an app, a workspace package, or the project root's own TypeScript files. */
interface Unit {
  name: string;
  dir: string;
  /** Path from the project root, `.` for the root. */
  rel: string;
}

const VITEST_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].flatMap((ext) => [
  `vitest.config.${ext}`,
  `vitest.workspace.${ext}`,
]);

const posix = (file: string): string => file.split(path.sep).join('/') || '.';

const within = (dir: string, inner: string): boolean => {
  const rel = path.relative(dir, inner);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** What follows `--`, untouched. */
export function passThrough(raw: readonly string[]): string[] {
  const at = raw.indexOf('--');
  return at === -1 ? [] : raw.slice(at + 1);
}

function parseJobs(args: Record<string, unknown>): number {
  if (args.jobs === undefined) return DEFAULT_JOBS;
  const jobs = typeof args.jobs === 'string' ? Number(args.jobs) : Number.NaN;
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new MfeflowError(
      'E107',
      `--jobs ${JSON.stringify(args.jobs)}: give a whole number of 1 or more`,
    );
  }
  return jobs;
}

async function hasFile(dir: string, names: readonly string[]): Promise<boolean> {
  const found = await Promise.all(names.map((name) => readText(path.join(dir, name))));
  return found.some((text) => text !== undefined);
}

async function scriptsOf(dir: string): Promise<Record<string, unknown>> {
  const text = await readText(path.join(dir, 'package.json'));
  if (text === undefined) return {};
  try {
    const doc: unknown = JSON.parse(text);
    const scripts: unknown =
      typeof doc === 'object' && doc !== null ? Reflect.get(doc, 'scripts') : {};
    return typeof scripts === 'object' && scripts !== null ? { ...scripts } : {};
  } catch {
    return {};
  }
}

const appUnit = (app: AppView): Unit => ({ name: app.name, dir: app.dir, rel: app.rel });

/** The apps, the workspace packages that have a `typecheck` script, and the root when it has `typecheck:tooling`. */
async function typecheckUnits(view: ProjectView): Promise<Unit[]> {
  const apps = view.apps.filter((a) => a.present).map(appUnit);
  const appDirs = new Set(view.apps.map((a) => a.dir));
  const packages = await Promise.all(
    view.workspace
      .filter((p) => !appDirs.has(p.dir) && p.dir !== view.root)
      .map(async (p): Promise<Unit | undefined> =>
        (await scriptsOf(p.dir)).typecheck === undefined
          ? undefined
          : { name: p.pkg.name ?? p.rel, dir: p.dir, rel: p.rel },
      ),
  );
  const tooling =
    (await scriptsOf(view.root))['typecheck:tooling'] === undefined
      ? []
      : [{ name: 'tooling', dir: view.root, rel: '.' }];
  return [...apps, ...packages.filter((u) => u !== undefined), ...tooling];
}

/** `--only` wins; else the app or package the command runs in; else every unit. */
function select(
  units: readonly Unit[],
  args: Record<string, unknown>,
  root: string,
  cwd: string,
): Unit[] {
  const only = splitList(typeof args.only === 'string' ? args.only : undefined);
  if (only !== undefined) {
    const known = units.map((u) => u.name);
    const unknown = only.filter((n) => !known.includes(n));
    if (unknown.length > 0) {
      throw new MfeflowError(
        'E107',
        `--only ${unknown.join(', ')}: no such app (apps: ${known.join(', ')})`,
      );
    }
    return units.filter((u) => only.includes(u.name));
  }
  const here = units
    .filter((u) => u.dir !== root && within(u.dir, cwd))
    .toSorted((a, b) => b.dir.length - a.dir.length)[0];
  return here === undefined ? [...units] : [here];
}

async function binary(tool: ToolName, from: string, root: string, what: string): Promise<string> {
  const bin = await resolveTool(tool, from, root);
  if (bin !== undefined) return bin;
  const where = posix(path.relative(root, from));
  const place = where === '.' ? 'the project root' : `${where} or above it, up to the project root`;
  throw new MfeflowError(
    'E311',
    `${TOOL_PACKAGE[tool]} is not installed: no node_modules/.bin/${tool} in ${place}. \`mfeflow ${what}\` runs the project's own copy.`,
  );
}

function target(
  name: string,
  tool: ToolName,
  bin: string,
  args: readonly string[],
  cwd: string,
  root: string,
): Target {
  return {
    name,
    tool,
    bin,
    args,
    cwd,
    display: [tool, ...args].join(' '),
    rel: posix(path.relative(root, cwd)),
  };
}

type Plan = (
  view: ProjectView,
  args: Record<string, unknown>,
  extra: readonly string[],
  cwd: string,
) => Promise<{ targets: Target[]; prefix: boolean; nothing?: string }>;

const projectNameOf = (app: AppView): string => app.pkg?.name ?? app.name;

const planTypecheck: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const units = select(await typecheckUnits(view), args, root, cwd);
  const targets = await Promise.all(
    units.map(async (u) =>
      target(
        u.name,
        'tsc',
        await binary('tsc', u.dir, root, 'typecheck'),
        ['--noEmit', ...extra],
        u.dir,
        root,
      ),
    ),
  );
  return { targets, prefix: true, nothing: 'there is no app or package with TypeScript to check.' };
};

const planTest: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const apps = view.apps.filter((a) => a.present);
  const chosen = select(apps.map(appUnit), args, root, cwd);
  const partial = chosen.length < apps.length;
  if (await hasFile(root, VITEST_CONFIGS)) {
    const names = chosen.flatMap((u) => {
      const app = apps.find((a) => a.name === u.name);
      return app === undefined ? [] : ['--project', projectNameOf(app)];
    });
    const bin = await binary('vitest', root, root, 'test');
    return {
      targets: [
        target('test', 'vitest', bin, ['run', ...(partial ? names : []), ...extra], root, root),
      ],
      prefix: false,
    };
  }
  const withConfig = await Promise.all(
    chosen.map(async (u) => ((await hasFile(u.dir, VITEST_CONFIGS)) ? u : undefined)),
  );
  const found = withConfig.filter((u) => u !== undefined);
  if (found.length === 0) {
    throw new MfeflowError(
      'E311',
      'vitest is not set up: there is no vitest.config in the project root or in the apps. Add it with `mfeflow add testing`.',
    );
  }
  const targets = await Promise.all(
    found.map(async (u) =>
      target(
        u.name,
        'vitest',
        await binary('vitest', u.dir, root, 'test'),
        ['run', ...extra],
        u.dir,
        root,
      ),
    ),
  );
  return { targets, prefix: targets.length > 1 };
};

const planLint: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const apps = view.apps.filter((a) => a.present);
  const chosen = select(apps.map(appUnit), args, root, cwd);
  const paths = chosen.length < apps.length ? chosen.map((u) => u.rel) : [];
  const bin = await binary('oxlint', root, root, 'lint');
  return {
    targets: [
      target(
        'lint',
        'oxlint',
        bin,
        ['--type-aware', '--deny-warnings', ...paths, ...extra],
        root,
        root,
      ),
    ],
    prefix: false,
  };
};

function formatSummary(result: ToolResult): string {
  const parts = result.runs.map((r) => {
    const seconds = `${(r.durationMs / 1000).toFixed(1)}s`;
    return r.ok
      ? `${r.name} ok ${seconds}`
      : `${r.name} FAILED (exit ${String(r.exitCode)}) ${seconds}`;
  });
  return `mfeflow: ${result.command}: ${parts.join(', ')}`;
}

async function runTool(
  command: ToolResult['command'],
  plan: Plan,
  defs: ArgsDef,
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<ToolResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const jobs = parseJobs(args);
  const root = await findProjectRoot(globals.cwd);
  const view = await inspectProject(root, rt.io);
  const planned = await plan(view, args, passThrough(raw), globals.cwd);
  const out = (text: string): void => {
    if (globals.json) rt.io.stderr(text);
    else rt.io.stdout(text);
  };
  const base = { ok: true, command, root, dryRun: globals.dryRun, interrupted: false };
  const { targets } = planned;
  if (targets.length === 0) {
    out(`mfeflow: ${planned.nothing ?? 'nothing to run.'}`);
    return { ...base, runs: [] };
  }
  if (globals.dryRun) {
    for (const t of targets) out(`${t.name}: ${t.display} in ${t.rel}`);
    return { ...base, runs: [] };
  }
  const color =
    rt.io.env.NO_COLOR === undefined &&
    !globals.json &&
    (rt.io.interactive || rt.io.env.FORCE_COLOR !== undefined);
  const outcome = await runTargets(targets, {
    host: rt.dev ?? realDevHost(),
    out,
    width: planned.prefix ? Math.max(...targets.map((t) => t.name.length)) : undefined,
    jobs,
    env: color ? { FORCE_COLOR: '1' } : {},
  });
  const result: ToolResult = {
    ...base,
    ok:
      !outcome.interrupted &&
      outcome.runs.length === targets.length &&
      outcome.runs.every((r) => r.ok),
    interrupted: outcome.interrupted,
    runs: outcome.runs,
  };
  out(formatSummary(result));
  return result;
}

export const runTypecheck = (rt: Runtime, args: Record<string, unknown>, raw: readonly string[]) =>
  runTool('typecheck', planTypecheck, TYPECHECK_ARGS, rt, args, raw);

export const runTest = (rt: Runtime, args: Record<string, unknown>, raw: readonly string[]) =>
  runTool('test', planTest, TEST_ARGS, rt, args, raw);

export const runLint = (rt: Runtime, args: Record<string, unknown>, raw: readonly string[]) =>
  runTool('lint', planLint, LINT_ARGS, rt, args, raw);
