import path from 'node:path';
import {
  COST_MODEL,
  judgeCost,
  judgeRemoteInitial,
  primaryExpose,
  type CostModel,
} from '@mfeflow/contracts';
import { findProjectRoot } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals } from '../args';
import { finding, type Finding } from '../findings';
import { inspectProject, type AppView, type ProjectView } from '../inspect';
import type { BudgetResult, RemoteBudget, ShellBudget } from '../output';
import { exitForFindings } from '../report';
import type { Runtime } from '../runtime';
import { KB, kb, remoteSizes, shellInitial } from '../sizes';

export const BUDGET_ARGS = {
  dist: {
    type: 'string',
    description: 'Build output folder inside each app (default dist)',
    valueHint: 'dir',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export function modelOf(view: ProjectView): CostModel {
  const given = view.project.budget ?? {};
  return {
    lcpDeltaMs: given.lcpDeltaMs ?? COST_MODEL.lcpDeltaMs,
    shellKb: given.shellKb ?? COST_MODEL.shellKb,
    remoteKb: given.remoteKb ?? COST_MODEL.remoteKb,
  };
}

const notBuilt = (app: AppView, what: string): Finding =>
  finding('budget', 'E305', `${app.name}: ${what} not found in ${app.rel}`, { app: app.name });

async function shellBudget(
  app: AppView,
  dist: string,
  model: CostModel,
  baselineKb: number | undefined,
  out: Finding[],
): Promise<ShellBudget | undefined> {
  const size = await shellInitial(path.join(app.dir, dist));
  if (size === undefined) {
    out.push(notBuilt(app, `${dist}/index.html and its scripts`));
    return undefined;
  }
  const initialKb = kb(size.bytes);
  const budgetKb = baselineKb === undefined ? null : baselineKb + model.shellKb;
  const pass =
    baselineKb === undefined
      ? null
      : judgeCost(
          {
            shellBytes: size.bytes,
            monolithBytes: baselineKb * KB,
            remoteBytes: {},
            lcpDeltaMs: 0,
          },
          model,
        ).shell.pass;
  if (pass === false) {
    out.push(
      finding(
        'budget',
        'E304',
        `${app.name} loads ${String(initialKb)} KB of JS first; your one-app baseline is ${String(baselineKb)} KB and the shell may add ${String(model.shellKb)} KB`,
        { app: app.name },
      ),
    );
  }
  return {
    name: app.name,
    initialKb,
    scripts: size.files.length,
    baselineKb: baselineKb ?? null,
    budgetKb,
    pass,
  };
}

async function remoteBudget(
  app: AppView,
  dist: string,
  model: CostModel,
  out: Finding[],
): Promise<RemoteBudget | undefined> {
  const size = await remoteSizes(path.join(app.dir, dist));
  if (size === undefined) {
    out.push(notBuilt(app, `${dist}/mf-manifest.json and its entry`));
    return undefined;
  }
  const entryKb = kb(size.entryBytes);
  const pass = judgeCost(
    {
      shellBytes: 0,
      monolithBytes: 0,
      remoteBytes: { [app.name]: size.entryBytes },
      lcpDeltaMs: 0,
    },
    model,
  ).remotes.every((r) => r.pass);
  if (!pass) {
    out.push(
      finding(
        'budget',
        'E304',
        `${app.name}'s entry is ${String(entryKb)} KB; a remote may add ${String(model.remoteKb)} KB`,
        { app: app.name },
      ),
    );
  }
  const own = app.mfe.state === 'ok' ? app.mfe.value : undefined;
  const budgetKb = own?.budgets?.initialJsKb ?? null;
  const expose = primaryExpose(Object.keys(size.exposes));
  const routes = (own?.routes ?? []).map((route) => {
    const verdict = judgeRemoteInitial(
      {
        entryBytes: size.entryBytes,
        exposeBytes: expose === undefined ? 0 : (size.exposes[expose] ?? 0),
      },
      budgetKb ?? undefined,
      model,
    );
    const total = verdict.totalKb;
    const routePass = budgetKb === null ? null : verdict.pass;
    if (routePass === false) {
      out.push(
        finding(
          'budget',
          'E304',
          `${app.name} on ${route} loads ${String(total)} KB; mfe.json budgets.initialJsKb is ${String(budgetKb)}`,
          { app: app.name, path: `${app.rel}/mfe.json` },
        ),
      );
    }
    return { route, expose: expose ?? null, kb: total, budgetKb, pass: routePass };
  });
  return { name: app.name, entryKb, budgetKb: model.remoteKb, pass, routes };
}

export async function runBudget(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<BudgetResult> {
  assertKnownFlags(raw, BUDGET_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const dist = typeof args.dist === 'string' && args.dist !== '' ? args.dist : 'dist';
  const view = await inspectProject(await findProjectRoot(globals.cwd));
  const model = modelOf(view);
  const findings: Finding[] = [];
  const baseline = view.project.budget?.baselineKb;
  const present = view.apps.filter((a) => a.present);
  const shells = (
    await Promise.all(
      present
        .filter((a) => a.kind === 'shell')
        .map((a) => shellBudget(a, dist, model, baseline, findings)),
    )
  ).filter((s) => s !== undefined);
  const remotes = (
    await Promise.all(
      present.filter((a) => a.kind === 'remote').map((a) => remoteBudget(a, dist, model, findings)),
    )
  ).filter((r) => r !== undefined);
  const result: BudgetResult = {
    ok: exitForFindings(findings) === 0,
    command: 'budget',
    root: view.root,
    model,
    shells,
    remotes,
    findings,
  };
  if (!globals.json) rt.io.stdout(formatBudget(result));
  return result;
}

export function formatBudget(result: BudgetResult): string {
  const lines = ['Initial JS, gzip (1 KB = 1024 bytes):'];
  for (const s of result.shells) {
    const limit =
      s.budgetKb === null
        ? 'no baseline set (budget.baselineKb), not checked'
        : `limit ${String(s.budgetKb)}`;
    lines.push(
      `  shell ${s.name}: ${String(s.initialKb)} KB in ${String(s.scripts)} scripts, ${limit}`,
    );
  }
  for (const r of result.remotes) {
    lines.push(`  remote ${r.name}: entry ${String(r.entryKb)} KB, limit ${String(r.budgetKb)}`);
    for (const route of r.routes) {
      const limit = route.budgetKb === null ? 'no budget' : `limit ${String(route.budgetKb)}`;
      lines.push(
        `    ${route.route} (${route.expose ?? 'no expose'}): ${String(route.kb)} KB, ${limit}`,
      );
    }
  }
  lines.push(`LCP (+${String(result.model.lcpDeltaMs)} ms) is measured by the perf job, not here.`);
  for (const f of result.findings) {
    lines.push('', `error ${f.code} ${f.message}`, `  Fix: ${f.fix}`, `  ${f.docs}`);
  }
  return lines.join('\n');
}
