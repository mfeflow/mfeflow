import {
  findProjectRoot,
  loadProject,
  MfeflowError,
  renderDiff,
  type DivergedUpgrade,
  type FileChange,
  type Plan,
  type UpgradePlan,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import {
  assertKnownFlags,
  GLOBAL_ARGS,
  readGlobals,
  repeated,
  splitList,
  text,
  type Globals,
} from '../args';
import { planReport, type UpgradeFileReport, type UpgradeResult } from '../output';
import { withProjectChange } from '../pipeline';
import type { Runtime } from '../runtime';
import { trustedIn } from '../trust';
import { planProjectUpgrade, type IntegrityState, type ProjectUpgrade } from '../upgrade';
import { readPackageJson } from '../version';
import { writePlan, type WriteOutcome } from '../write';

export const UPGRADE_ARGS = {
  to: {
    type: 'string',
    description: 'The version to upgrade to; only the version of this mfeflow is possible',
    valueHint: 'version',
  },
  accept: {
    type: 'string',
    description: 'Replace a file you changed with the new version: a path, a list, or all',
    valueHint: 'path|all',
  },
  keep: {
    type: 'string',
    description: 'Keep your version of a file you changed: a path, a list, or all',
    valueHint: 'path|all',
  },
  // A boolean for the parser, so a bare flag does not swallow the next one; the names are read from the raw arguments.
  'accept-changed-content': {
    type: 'boolean',
    description:
      'Take registry content that differs from the hash recorded in mfeflow.json: every feature, or only those named after the flag (a,b)',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const REASONS: Record<DivergedUpgrade['reason'], string> = {
  edited: 'you edited it',
  untracked: 'mfeflow did not write it, but a different file is there',
  'edited-by-cli': 'mfeflow added keys to it',
  'skipped-feature': 'a feature that may have changed it could not be replayed',
  symlink: 'a symlink, never written over',
};

const MANIFESTS = /(^|\/)(package\.json|pnpm-workspace\.yaml)$/;
const STRUCTURED = /(^|\/)(package\.json|pnpm-workspace\.yaml|turbo\.json)$/;
const SHOWN = 12;

/** `--accept a,b` and `--accept a --accept b`, or `all`. Undefined when the flag is absent. */
function pathsOf(raw: readonly string[], flag: string): ReadonlySet<string> | 'all' | undefined {
  const values = repeated(raw, flag).flatMap((v) => splitList(v) ?? []);
  if (values.length === 0) return undefined;
  if (values.includes('all')) return 'all';
  return new Set(values.map((v) => v.replaceAll('\\', '/').replace(/^\.\//, '')));
}

const ACCEPT_CHANGED = 'accept-changed-content';

/**
 * `--accept-changed-content` alone takes every changed feature; `--accept-changed-content a,b`
 * (or `=a,b`) only those. Undefined when the flag is absent.
 */
function acceptChangedOf(raw: readonly string[]): true | ReadonlySet<string> | undefined {
  const flag = `--${ACCEPT_CHANGED}`;
  const stop = raw.indexOf('--');
  const tokens = stop === -1 ? raw : raw.slice(0, stop);
  const at = tokens.findIndex((t) => t === flag || t.startsWith(`${flag}=`));
  if (at === -1) return undefined;
  const token = tokens[at] ?? '';
  const next = tokens[at + 1];
  const given = token.includes('=')
    ? token.slice(flag.length + 1)
    : next !== undefined && !next.startsWith('-')
      ? next
      : '';
  const names = splitList(given) ?? [];
  return names.length === 0 || names.includes('all') ? true : new Set(names);
}

function assertAcceptChanged(
  accept: true | ReadonlySet<string> | undefined,
  features: Record<string, unknown>,
): void {
  if (!(accept instanceof Set)) return;
  const unknown = [...accept].filter((name) => !(name in features));
  if (unknown.length > 0) {
    throw new MfeflowError(
      'E107',
      `--${ACCEPT_CHANGED} ${unknown.join(', ')} is not a feature installed in this project`,
    );
  }
}

function assertDecisions(
  accept: ReadonlySet<string> | 'all' | undefined,
  keep: ReadonlySet<string> | 'all' | undefined,
): void {
  if (accept === 'all' && keep === 'all') {
    throw new MfeflowError('E107', '--accept all and --keep all cannot be used together');
  }
  if (accept instanceof Set && keep instanceof Set) {
    const both = [...accept].filter((p) => keep.has(p));
    if (both.length > 0) {
      throw new MfeflowError('E107', `${both.join(', ')} is in both --accept and --keep`);
    }
  }
}

/** Named paths must be files that need a decision, and a symlink cannot be accepted. */
function assertNamed(
  flag: string,
  named: ReadonlySet<string> | 'all' | undefined,
  diverged: readonly DivergedUpgrade[],
): void {
  if (!(named instanceof Set)) return;
  for (const file of named) {
    const entry = diverged.find((d) => d.path === file);
    if (entry === undefined) {
      const choices = diverged.map((d) => d.path).join(', ');
      throw new MfeflowError(
        'E107',
        `--${flag} ${file} is not a file that needs a decision${choices === '' ? '' : ` (they are: ${choices})`}`,
      );
    }
    if (entry.reason === 'symlink') {
      throw new MfeflowError(
        'E107',
        `--${flag} ${file} is a symlink; mfeflow never writes over one`,
      );
    }
  }
}

function describeJson(source: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(source ?? '{}');
    return typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value))
      : {};
  } catch {
    return {};
  }
}

function rangesOf(pkg: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const value = pkg[section];
    if (typeof value !== 'object' || value === null) continue;
    for (const [name, range] of Object.entries(value)) {
      if (typeof range === 'string') out.set(name, range);
    }
  }
  return out;
}

/** What a structured edit did, in words: ranges moved and scripts and dependencies added for a package.json. */
function structuredLines(change: FileChange, plan: Plan, to: string): string[] {
  if (!change.path.endsWith('package.json')) {
    return [
      change.path.endsWith('turbo.json')
        ? `${change.path}: tasks added`
        : `${change.path}: catalog entries and build rules added`,
    ];
  }
  const before = rangesOf(describeJson(change.before));
  const after = rangesOf(describeJson(change.after));
  const moved = [...after].filter(
    ([name, range]) =>
      before.has(name) && before.get(name) !== range && /^(mfeflow|@mfeflow\/)/.test(name),
  ).length;
  const parts: string[] = [];
  if (moved > 0) parts.push(`${String(moved)} @mfeflow ranges moved to ^${to}`);
  const scripts = plan.scripts.filter((s) => s.file === change.path).map((s) => s.name);
  if (scripts.length > 0) parts.push(`scripts added: ${scripts.join(', ')}`);
  const deps = plan.dependencies.filter((d) => d.file === change.path).map((d) => d.name);
  if (deps.length > 0) parts.push(`dependencies added: ${deps.join(', ')}`);
  return [`${change.path}: ${parts.length === 0 ? 'edited' : parts.join('; ')}`];
}

function decisionOf(entry: DivergedUpgrade): UpgradeFileReport['decision'] {
  return entry.decision ?? 'undecided';
}

function divergedReport(entry: DivergedUpgrade): UpgradeFileReport {
  return {
    path: entry.path,
    reason: entry.reason,
    decision: decisionOf(entry),
    lostKeys: entry.lostKeys ?? [],
    changedValues: entry.changedValues ?? [],
    diff: entry.diff,
  };
}

function list(title: string, items: readonly string[], limit = SHOWN): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, limit).map((item) => `  ${item}`);
  const rest = items.length - shown.length;
  return [
    `${title} (${String(items.length)}):`,
    ...shown,
    ...(rest > 0 ? [`  and ${String(rest)} more`] : []),
  ];
}

/** What accepting the new file drops: keys it lacks, and values it changes. */
function lostMessage(entry: DivergedUpgrade): string {
  const changed = new Set(entry.changedValues ?? []);
  const gone = (entry.lostKeys ?? []).filter((key) => !changed.has(key));
  const parts = [
    ...(gone.length > 0 ? [`your keys ${gone.join(', ')} are not in the new file`] : []),
    ...(changed.size > 0
      ? [`your values for ${[...changed].join(', ')} differ from the new file`]
      : []),
  ];
  const fix =
    gone.length > 0 ? 'add the keys back with mfeflow add env-key' : 'set the values again';
  return `${parts.join(' and ')}; --accept drops them, ${fix} afterwards`;
}

function divergedLines(entries: readonly DivergedUpgrade[]): string[] {
  const lines = [`Files you changed (${String(entries.length)}):`];
  for (const entry of entries) {
    const state =
      entry.decision === 'accept'
        ? 'will be replaced'
        : entry.decision === 'keep'
          ? 'kept'
          : entry.reason === 'symlink'
            ? 'left alone, no decision needed'
            : 'needs a decision';
    lines.push(`  ${entry.path}  ${REASONS[entry.reason]}; ${state}`);
    if (entry.lostKeys !== undefined && entry.decision !== 'keep') {
      lines.push(`    ${lostMessage(entry)}`);
    }
  }
  return lines;
}

interface Sorted {
  replaced: string[];
  created: string[];
  structured: FileChange[];
}

function sortChanges(up: UpgradePlan): Sorted {
  const out: Sorted = { replaced: [], created: [], structured: [] };
  for (const change of up.plan.changes) {
    if (change.action === 'create') out.created.push(change.path);
    else if (STRUCTURED.test(change.path)) out.structured.push(change);
    else out.replaced.push(change.path);
  }
  return out;
}

function summaryText(up: ProjectUpgrade, sorted: Sorted): string {
  const lines = [
    `Upgrading ${up.from} to ${up.to} (${up.from} read from ${up.fromSource})`,
    '',
    ...list('Replaced, you had not changed them', sorted.replaced),
    ...list('Created', sorted.created),
    ...(sorted.structured.length > 0
      ? [
          'Edited in place:',
          ...sorted.structured.flatMap((c) =>
            structuredLines(c, up.plan, up.to).map((line) => `  ${line}`),
          ),
        ]
      : []),
    ...(up.diverged.length > 0 ? divergedLines(up.diverged) : []),
    ...integrityLines(up.integrity),
    ...list('Missing, you deleted them and they stay deleted', up.missing),
    ...list('No longer generated, left where they are', up.removed),
    ...list(
      'Migrations run',
      up.migrations.map((m) => `${m.feature} ${m.from} to ${m.to}`),
    ),
    ...up.plan.warnings.map((w) => `Warning: ${w}`),
  ];
  return lines.join('\n').replaceAll(/\n{3,}/g, '\n\n');
}

const INTEGRITY_NOTES: Record<IntegrityState, string | undefined> = {
  verified: undefined,
  'first-seen':
    'no hash was recorded for it, so what the registry served could not be checked; it is recorded now',
  'accepted-changed':
    'the registry serves other content than was recorded; taken with --accept-changed-content',
};

function integrityLines(integrity: ProjectUpgrade['integrity']): string[] {
  return Object.entries(integrity).flatMap(([name, state]) => {
    const note = INTEGRITY_NOTES[state];
    return note === undefined ? [] : [`Registry feature ${name}: ${note}`];
  });
}

/** Files that wait for a decision. A symlink never does: it is reported and left alone. */
function undecidedOf(up: UpgradePlan): DivergedUpgrade[] {
  return up.diverged.filter((d) => d.decision === undefined && d.reason !== 'symlink');
}

function undecidedMessage(undecided: readonly DivergedUpgrade[]): string {
  const names = undecided.slice(0, SHOWN).map((d) => d.path);
  const more =
    undecided.length > names.length ? ` and ${String(undecided.length - names.length)} more` : '';
  return `${String(undecided.length)} not decided: ${names.join(', ')}${more}`;
}

/** The target version: the one running, because the files come from this mfeflow. */
/** A registry the user has not trusted on this machine is never asked, as in `add`. */
function assertTrusted(
  features: Record<string, unknown>,
  registries: Record<string, string> | undefined,
  trusted: ReadonlySet<string>,
): void {
  const untrusted = new Set(
    Object.keys(features)
      .filter((name) => name.startsWith('@'))
      .map((name) => name.slice(0, name.indexOf('/')))
      .filter((namespace) => namespace in (registries ?? {}) && !trusted.has(namespace)),
  );
  if (untrusted.size > 0) {
    throw new MfeflowError(
      'E405',
      `${[...untrusted].join(', ')} is installed here but not trusted on this machine, so it was not requested`,
    );
  }
}

function targetOf(args: Record<string, unknown>): string {
  const running = readPackageJson().version;
  const to = text(args, 'to') ?? running;
  if (to !== running) {
    throw new MfeflowError(
      'E107',
      `--to ${to}: this mfeflow is ${running} and generates ${running} files; run pnpm dlx mfeflow@${to} upgrade to upgrade to ${to}`,
    );
  }
  return to;
}

/** Without a person to ask, nothing is written while a changed file is undecided or a registry feature unconfirmed. */
function assertMayWrite(
  globals: Globals,
  up: UpgradePlan,
  undecided: readonly DivergedUpgrade[],
): void {
  if (globals.canPrompt || globals.dryRun) return;
  if (undecided.length > 0) throw new MfeflowError('E604', undecidedMessage(undecided));
  if (!globals.yes && up.plan.changes.some((c) => c.trust === 'third-party')) {
    throw new MfeflowError(
      'E107',
      'a feature from a registry is part of this upgrade; pass --yes to apply it without a terminal to confirm in',
    );
  }
}

function printPlan(
  rt: Runtime,
  globals: Globals,
  up: ProjectUpgrade,
  sorted: Sorted,
  upToDate: boolean,
): void {
  const undecided = undecidedOf(up);
  if (!upToDate || undecided.length > 0) rt.io.stdout(summaryText(up, sorted));
  const open = globals.dryRun ? up.diverged : undecided;
  if (open.length > 0 && (globals.dryRun || globals.canPrompt || globals.verbose)) {
    rt.io.stdout(
      `\nFiles you changed, as a diff from yours to the new version:\n\n${open.map((d) => d.diff).join('\n')}`,
    );
  }
  if (undecided.length > 0) {
    rt.io.stdout(
      '\nDecide each file with --accept <path|all> to take the new version or --keep <path|all> to keep yours.',
    );
  }
}

function printOutcome(
  rt: Runtime,
  root: string,
  up: UpgradePlan,
  outcome: WriteOutcome,
  upToDate: boolean,
) {
  if (upToDate) {
    rt.io.stdout(`\n${root} is already at ${up.to}; nothing to write.`);
    return;
  }
  if (outcome.written.length === 0 && !outcome.dryRun) {
    rt.io.stdout('\nNothing was written.');
    return;
  }
  if (outcome.dryRun) {
    rt.io.stdout(`\n${renderDiff(outcome.shown)}\nDry run: nothing was written.`);
    return;
  }
  const left = undecidedOf(up).length;
  const note = left > 0 ? ` ${String(left)} files you changed were left as they are.` : '';
  rt.io.stdout(`\nUpgraded to ${up.to}.${note}`);
}

export async function runUpgrade(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<UpgradeResult> {
  assertKnownFlags(raw, UPGRADE_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const to = targetOf(args);
  const accept = pathsOf(raw, 'accept');
  const keep = pathsOf(raw, 'keep');
  assertDecisions(accept, keep);

  const root = await findProjectRoot(globals.cwd);
  const project = await loadProject(root);
  const acceptChanged = acceptChangedOf(raw);
  assertAcceptChanged(acceptChanged, project.features);
  const trusted = await trustedIn(rt, project.registries);
  assertTrusted(project.features, project.registries, trusted.fetch);
  const context = {
    roots: rt.roots,
    fetch: rt.fetch,
    trusted: trusted.privateOk,
    ...(acceptChanged === undefined ? {} : { acceptChanged }),
  };
  const up = await planProjectUpgrade(context, root, project, to, {
    ...(accept === undefined ? {} : { accept }),
    ...(keep === undefined ? {} : { keep }),
  });
  assertNamed('accept', accept, up.diverged);
  assertNamed('keep', keep, up.diverged);
  assertMayWrite(globals, up, undecidedOf(up));

  const sorted = sortChanges(up);
  const shownPlan = withProjectChange(up.plan, up.project);
  const nothingToWrite = shownPlan.changes.length === 0;
  const upToDate = nothingToWrite && undecidedOf(up).length === 0;
  if (!globals.json) printPlan(rt, globals, up, sorted, upToDate);
  const outcome: WriteOutcome = nothingToWrite
    ? { dryRun: globals.dryRun, shown: shownPlan, written: [], installed: false }
    : await writePlan({
        rt,
        globals,
        root,
        plan: up.plan,
        project: up.project,
        install: up.plan.changes.some((c) => MANIFESTS.test(c.path)),
        exactProject: true,
        quiet: true,
      });
  if (!globals.json) printOutcome(rt, root, up, outcome, upToDate);
  return {
    ok: true,
    command: 'upgrade',
    dryRun: outcome.dryRun,
    root,
    from: up.from,
    fromSource: up.fromSource,
    to: up.to,
    upToDate,
    replaced: sorted.replaced,
    created: sorted.created,
    edited: sorted.structured.map((c) => c.path),
    diverged: up.diverged.map(divergedReport),
    integrity: up.integrity,
    missing: up.missing,
    removed: up.removed,
    migrations: up.migrations,
    plan: planReport(outcome.shown),
    written: outcome.written,
    installed: outcome.installed,
    ...(outcome.dryRun ? { diff: renderDiff(outcome.shown) } : {}),
  };
}
