import { findProjectRoot, type PlanBuilder } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, type Globals } from '../args';
import { COMPAT_CHECKS, DOCTOR_CHECKS, VALIDATE_CHECKS } from '../checks';
import type { Check, Finding } from '../findings';
import { registryEntryFiles } from '../glue';
import { inspectProject, type ProjectView } from '../inspect';
import { chooseLocal } from '../local';
import type { ReportResult } from '../output';
import { createBuilder } from '../pipeline';
import { formatReport, runChecks, summarizeReport } from '../report';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';

export const DOCTOR_ARGS = {
  fix: {
    type: 'boolean',
    description: 'Repair what is safe: missing workspace versions and registry entries',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export const VALIDATE_ARGS = { ...GLOBAL_ARGS } as const satisfies ArgsDef;
export const COMPAT_ARGS = { ...GLOBAL_ARGS } as const satisfies ArgsDef;

const DEFAULT_VERSION = '0.0.0';

function withVersion(source: string): string {
  const doc: unknown = JSON.parse(source);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return source;
  const indent = /^(\s+)"/m.exec(source)?.[1] ?? '  ';
  const entries = Object.entries(doc);
  const at = Math.max(1, entries.findIndex(([key]) => key === 'name') + 1);
  const next = Object.fromEntries([
    ...entries.slice(0, at),
    ['version', DEFAULT_VERSION],
    ...entries.slice(at),
  ]);
  return `${JSON.stringify(next, null, indent)}\n`;
}

async function plannedFixes(
  rt: Runtime,
  view: ProjectView,
  findings: readonly Finding[],
  builder: PlanBuilder,
): Promise<number> {
  let count = 0;
  const missingEnvs = new Map<string, string[]>();
  for (const f of findings.filter((x) => x.fixable)) {
    if (f.code === 'MFEFLOW_E111' && f.path !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- one small file at a time
      await builder.patch(f.path, withVersion);
      count += 1;
    } else if (f.code === 'MFEFLOW_E114' && f.app !== undefined && f.path !== undefined) {
      const env = f.path.split('/')[2] ?? '';
      missingEnvs.set(f.app, [...(missingEnvs.get(f.app) ?? []), env]);
    }
  }
  for (const [name, envs] of missingEnvs) {
    const port = view.apps.find((a) => a.name === name)?.port ?? 0;
    // oxlint-disable-next-line no-await-in-loop -- one remote at a time
    for (const file of await registryEntryFiles(rt.roots, { name, port }, envs)) {
      // oxlint-disable-next-line no-await-in-loop -- as above
      await builder.create(file.path, file.content, false);
      count += 1;
    }
  }
  return count;
}

async function fixAll(
  rt: Runtime,
  globals: Globals,
  view: ProjectView,
  findings: readonly Finding[],
): Promise<number> {
  const { checkout } = chooseLocal(view.project, view.root, globals.cwd, undefined);
  const builder = createBuilder(view.root, checkout);
  await builder.captureProject();
  const count = await plannedFixes(rt, view, findings, builder);
  if (count === 0) return 0;
  const outcome = await writePlan({
    rt,
    globals: { ...globals, install: false },
    root: view.root,
    plan: builder.build(),
    project: view.project,
  });
  return outcome.dryRun ? 0 : count;
}

async function runGroup(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  command: ReportResult['command'],
  checks: readonly Check[],
  fix: boolean,
): Promise<ReportResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const root = await findProjectRoot(globals.cwd);
  let view = await inspectProject(root);
  let report = await runChecks(view, checks);
  let fixed = 0;
  if (fix && report.findings.some((f) => f.fixable)) {
    fixed = await fixAll(rt, globals, view, report.findings);
    if (fixed > 0) {
      view = await inspectProject(root);
      report = await runChecks(view, checks);
    }
  }
  const summary = summarizeReport(report, fixed);
  if (!globals.json) rt.io.stdout(formatReport(report, summary));
  return {
    ok: summary.errors === 0,
    command,
    root,
    summary,
    checks: report.checks,
    findings: report.findings,
  };
}

export function runDoctor(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<ReportResult> {
  return runGroup(rt, args, raw, DOCTOR_ARGS, 'doctor', DOCTOR_CHECKS, args.fix === true);
}

export function runValidate(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<ReportResult> {
  return runGroup(rt, args, raw, VALIDATE_ARGS, 'validate', VALIDATE_CHECKS, false);
}

export function runCheckCompat(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<ReportResult> {
  return runGroup(rt, args, raw, COMPAT_ARGS, 'check-compat', COMPAT_CHECKS, false);
}
