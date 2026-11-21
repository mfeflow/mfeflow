import path from 'node:path';
import { findProjectRoot, isInside, MfeflowError } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, splitList } from '../args';
import { inspectProject, readText, type AppView, type ProjectView } from '../inspect';
import type { ToolResult, ToolSkip } from '../output';
import { realDevHost } from '../proc';
import type { Runtime } from '../runtime';
import {
  isFile,
  resolveTool,
  runTargets,
  TOOL_PACKAGE,
  type Target,
  type ToolName,
} from '../tools';

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
  /** The package.json script that says how this folder is type checked. */
  script: string;
}

const VITEST_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].flatMap((ext) => [
  `vitest.config.${ext}`,
  `vitest.workspace.${ext}`,
]);

const posix = (file: string): string => file.split(path.sep).join('/') || '.';

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
  const found = await Promise.all(names.map((name) => isFile(path.join(dir, name))));
  return found.some(Boolean);
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

const appUnit = (app: AppView): Unit => ({
  name: app.name,
  dir: app.dir,
  rel: app.rel,
  script: 'typecheck',
});

/**
 * The apps, the workspace packages that have a `typecheck` script, and the root when it has
 * `typecheck:tooling`. A package or tooling folder whose name an app already has is left out and listed.
 */
async function typecheckUnits(view: ProjectView): Promise<{ units: Unit[]; skipped: ToolSkip[] }> {
  const apps = view.apps.filter((a) => a.present).map(appUnit);
  const appDirs = new Set(view.apps.map((a) => a.dir));
  const packages = await Promise.all(
    view.workspace
      .filter((p) => !appDirs.has(p.dir) && p.dir !== view.root)
      .map(async (p): Promise<Unit | undefined> =>
        (await scriptsOf(p.dir)).typecheck === undefined
          ? undefined
          : { name: p.pkg.name ?? p.rel, dir: p.dir, rel: p.rel, script: 'typecheck' },
      ),
  );
  const tooling: Unit[] =
    (await scriptsOf(view.root))['typecheck:tooling'] === undefined
      ? []
      : [{ name: 'tooling', dir: view.root, rel: '.', script: 'typecheck:tooling' }];
  const names = new Set(apps.map((u) => u.name));
  const units = [...apps];
  const skipped: ToolSkip[] = [];
  for (const unit of [...packages.filter((u) => u !== undefined), ...tooling]) {
    if (names.has(unit.name)) {
      skipped.push({
        name: unit.name,
        reason: `${unit.rel} has the same name as an app, so \`--only ${unit.name}\` means the app`,
      });
    } else {
      names.add(unit.name);
      units.push(unit);
    }
  }
  return { units, skipped };
}

/** `--only` wins; else the app or package the command runs in; else every unit. */
function select(
  units: readonly Unit[],
  args: Record<string, unknown>,
  root: string,
  cwd: string,
  noun: 'app' | 'target',
): Unit[] {
  if (args.only !== undefined) {
    const only = typeof args.only === 'string' ? (splitList(args.only) ?? []) : [];
    if (only.length === 0) {
      throw new MfeflowError(
        'E107',
        '--only needs at least one name, for example `--only shell,cart`',
      );
    }
    const known = units.map((u) => u.name);
    const unknown = only.filter((n) => !known.includes(n));
    if (unknown.length > 0) {
      throw new MfeflowError(
        'E107',
        `--only ${unknown.join(', ')}: no such ${noun} (${noun}s: ${known.join(', ')})`,
      );
    }
    return units.filter((u) => only.includes(u.name));
  }
  const here = units
    .filter((u) => u.dir !== root && isInside(u.dir, cwd))
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
  display = [tool, ...args].join(' '),
): Target {
  return {
    name,
    tool,
    bin,
    args,
    cwd,
    display,
    rel: posix(path.relative(root, cwd)),
  };
}

type Plan = (
  view: ProjectView,
  args: Record<string, unknown>,
  extra: readonly string[],
  cwd: string,
) => Promise<{ targets: Target[]; prefix: boolean; skipped: ToolSkip[]; nothing?: string }>;

const projectNameOf = (app: AppView): string => app.pkg?.name ?? app.name;

const PLAIN_TSC = /^\s*tsc\s+--noEmit\s*$/;

const planTypecheck: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const { packageManager } = view.project;
  const all = await typecheckUnits(view);
  const units = select(all.units, args, root, cwd, 'target');
  const skipped = [...all.skipped];
  const planned = await Promise.all(
    units.map(async (u): Promise<Target | undefined> => {
      const script = (await scriptsOf(u.dir))[u.script];
      if (typeof script === 'string' && !PLAIN_TSC.test(script)) {
        const forward =
          extra.length === 0 ? [] : [...(packageManager === 'npm' ? ['--'] : []), ...extra];
        return target(
          u.name,
          'tsc',
          packageManager,
          ['run', u.script, ...forward],
          u.dir,
          root,
          `${packageManager} run ${u.script}`,
        );
      }
      if (!(await isFile(path.join(u.dir, 'tsconfig.json')))) {
        skipped.push({ name: u.name, reason: 'no tsconfig.json' });
        return undefined;
      }
      return target(
        u.name,
        'tsc',
        await binary('tsc', u.dir, root, 'typecheck'),
        ['--noEmit', ...extra],
        u.dir,
        root,
      );
    }),
  );
  return {
    targets: planned.filter((t) => t !== undefined),
    prefix: true,
    skipped,
    nothing: 'there is no app or package with TypeScript to check.',
  };
};

const planTest: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const apps = view.apps.filter((a) => a.present);
  const chosen = select(apps.map(appUnit), args, root, cwd, 'app');
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
      skipped: [],
    };
  }
  const withConfig = await Promise.all(
    chosen.map(async (u) => ((await hasFile(u.dir, VITEST_CONFIGS)) ? u : undefined)),
  );
  const found = withConfig.filter((u) => u !== undefined);
  const skipped = chosen
    .filter((u) => !found.includes(u))
    .map((u) => ({ name: u.name, reason: 'no vitest config' }));
  if (found.length === 0) {
    throw new MfeflowError(
      'E311',
      `vitest is not set up: there is no vitest.config in the project root or in ${skipped.map((s) => s.name).join(', ')}. Add it with \`mfeflow add testing\`.`,
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
  return { targets, prefix: targets.length > 1, skipped };
};

const planLint: Plan = async (view, args, extra, cwd) => {
  const { root } = view;
  const apps = view.apps.filter((a) => a.present);
  const chosen = select(apps.map(appUnit), args, root, cwd, 'app');
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
    skipped: [],
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
  const { targets, skipped } = planned;
  const base = { ok: true, command, root, dryRun: globals.dryRun, interrupted: false, skipped };
  if (skipped.length > 0) {
    out(`mfeflow: skipped ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`);
  }
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
