import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlan, parseProject, type MfeflowProject, type UpgradePlan } from '@mfeflow/core';
import { assetRoots } from './assets';
import { readTree, removeDir, tempDir } from './testing';
import { planProjectUpgrade, replayOrder } from './upgrade';
import fixture from '../test-fixtures/project-0.1.0.json';

/** Pinned, so the snapshot does not move with every release. */
const TO = '0.5.0';
const EDITED = 'apps/shell/src/pages/Home.tsx';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** The 0.1.0 project in a temp folder, with `edits` written over it. No git, no child process. */
async function oldProject(
  edits: Record<string, string> = {},
): Promise<{ root: string; project: MfeflowProject }> {
  const root = await tempDir('mfeflow-upgrade-');
  dirs.push(root);
  for (const [file, content] of Object.entries({ ...fixture.files, ...edits })) {
    const target = path.join(root, ...file.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return { root, project: parseProject(fixture.files['mfeflow.json']) };
}

function parse(text: string | null | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(text ?? '{}');
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

const ctx = { roots: assetRoots(), fetch: () => Promise.reject(new Error('no network')) };

function summary(up: UpgradePlan) {
  return {
    from: [up.from, up.fromSource],
    to: up.to,
    changes: up.plan.changes.map((c) => `${c.action} ${c.path}`),
    diverged: up.diverged.map((d) => [d.path, d.reason]),
    removed: up.removed,
    missing: up.missing,
    dependencies: up.plan.dependencies,
    scripts: up.plan.scripts,
    warnings: up.plan.warnings,
    features: Object.fromEntries(up.plan.features.map((f) => [f.name, f.version])),
  };
}

describe('replayOrder', () => {
  it('puts core and tsconfig first, then recorded features in catalogue order', () => {
    const project = parseProject(fixture.files['mfeflow.json']);
    project.features = {
      testing: { version: '0.1.0' },
      core: { version: '0.1.0' },
      'ci-github': { version: '0.1.0' },
      tsconfig: { version: '0.1.0' },
      'lint-oxlint': { version: '0.1.0' },
    };
    expect(replayOrder(project)).toEqual([
      'core',
      'tsconfig',
      'lint-oxlint',
      'testing',
      'ci-github',
    ]);
  });
});

describe('planProjectUpgrade on the 0.1.0 fixture', () => {
  it('plans the real deltas between 0.1.0 and now', async () => {
    const { root, project } = await oldProject({ [EDITED]: 'my own home page\n' });
    const up = await planProjectUpgrade(ctx, root, project, TO);
    expect(summary(up)).toMatchSnapshot();
  });

  it('infers the baseline from the shell runtime range', async () => {
    const { root, project } = await oldProject();
    expect(project.cli).toBeUndefined();
    const up = await planProjectUpgrade(ctx, root, project, TO);
    expect([up.from, up.fromSource]).toEqual(['0.1.0', 'package.json']);
    expect(up.project.cli).toBe(TO);
  });

  it('replaces unmodified files and rewrites ranges, keeping package.json fields in order', async () => {
    const { root, project } = await oldProject();
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const changed = (file: string) => up.plan.changes.find((c) => c.path === file);
    expect(changed(EDITED)).toMatchObject({ action: 'patch' });
    const rootPkg = parse(changed('package.json')?.after);
    const oldPkg = parse(fixture.files['package.json']);
    expect(Object.keys(rootPkg)).toEqual(Object.keys(oldPkg));
    expect(rootPkg.devDependencies).toMatchObject({
      '@mfeflow/tsconfig': `^${TO}`,
      mfeflow: `^${TO}`,
    });
    expect(rootPkg.scripts).toMatchObject({ doctor: 'mfeflow doctor' });
    expect(rootPkg.engines).toEqual(oldPkg.engines);
    expect(changed('pnpm-workspace.yaml')?.after).toContain('esbuild: false');
  });

  it('flags a file you edited, with a diff, and does not write it', async () => {
    const { root, project } = await oldProject({ [EDITED]: 'my own home page\n' });
    const up = await planProjectUpgrade(ctx, root, project, TO);
    expect(up.plan.changes.map((c) => c.path)).not.toContain(EDITED);
    const home = up.diverged.find((d) => d.path === EDITED);
    expect(home?.reason).toBe('edited');
    expect(home?.yours).toBe('my own home page\n');
    expect(home?.diff).toContain('-my own home page');
  });

  it('writes nothing on a dry run', async () => {
    const { root, project } = await oldProject();
    const before = await readTree(root);
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const result = await applyPlan(up.plan, { root, project: up.project, dryRun: true });
    expect(result.written).toEqual([]);
    expect(await readTree(root)).toEqual(before);
  });

  it('applies, keeps your edit byte for byte, and a second plan finds nothing left to change', async () => {
    const { root, project } = await oldProject({ [EDITED]: 'my own home page\n' });
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const { project: saved } = await applyPlan(up.plan, { root, project: up.project });
    const after = await readTree(root);
    expect(after[EDITED]).toBe('my own home page\n');
    expect(parseProject(after['mfeflow.json'] ?? '').cli).toBe(TO);
    expect(saved?.cli).toBe(TO);

    const again = await planProjectUpgrade(
      ctx,
      root,
      parseProject(after['mfeflow.json'] ?? ''),
      TO,
    );
    expect(again.plan.changes).toEqual([]);
    expect(again.from).toBe(TO);
    expect(again.diverged.map((d) => d.path)).toContain(EDITED);
  });

  it('refuses to go backwards', async () => {
    const { root, project } = await oldProject();
    await expect(planProjectUpgrade(ctx, root, project, '0.0.9')).rejects.toMatchObject({
      code: 'MFEFLOW_E602',
    });
  });
});

describe('the core 0.4.0 migration: mfe.json becomes mfeflow.app.json', () => {
  const NEW_SCHEMA = 'https://mfeflow.github.io/mfeflow/schema/mfeflow-app.json';

  it('moves an unedited file to the new name, tracked like a fresh one', async () => {
    const { root, project } = await oldProject();
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const change = (file: string) => up.plan.changes.find((c) => c.path === file);
    expect(change('apps/cart/mfe.json')).toMatchObject({ action: 'delete' });
    expect(change('apps/cart/mfeflow.app.json')).toMatchObject({ action: 'create', track: true });
    expect(up.removed).not.toContain('apps/cart/mfe.json');

    const { project: saved } = await applyPlan(up.plan, { root, project: up.project });
    const after = await readTree(root);
    expect(Object.keys(after).filter((f) => f.endsWith('mfe.json'))).toEqual([]);
    expect(parse(after['apps/cart/mfeflow.app.json'])).toEqual({
      ...parse(fixture.files['apps/cart/mfe.json']),
      $schema: NEW_SCHEMA,
    });
    expect(Object.keys(saved?.files ?? {})).toContain('apps/cart/mfeflow.app.json');
    expect(Object.keys(saved?.files ?? {})).not.toContain('apps/cart/mfe.json');
  });

  it('keeps your edits, adds the schema URL, and leaves the file untracked', async () => {
    const mine =
      '{\n  "name": "cart",\n  "owner": "team-payments",\n  "shells": ["shell"],\n  "routes": ["/cart", "/cart/*"],\n  "exposes": ["./App"]\n}\n';
    const { root, project } = await oldProject({ 'apps/cart/mfe.json': mine });
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const created = up.plan.changes.find((c) => c.path === 'apps/cart/mfeflow.app.json');
    expect(created).toMatchObject({ action: 'create', track: false });
    expect(created?.after).toBe(mine.replace('{\n', `{\n  "$schema": "${NEW_SCHEMA}",\n`));

    const { project: saved } = await applyPlan(up.plan, { root, project: up.project });
    const after = await readTree(root);
    expect(after['apps/cart/mfe.json']).toBeUndefined();
    expect(parse(after['apps/cart/mfeflow.app.json'])).toMatchObject({ owner: 'team-payments' });
    expect(Object.keys(saved?.files ?? {})).not.toContain('apps/cart/mfeflow.app.json');

    const again = await planProjectUpgrade(
      ctx,
      root,
      parseProject(after['mfeflow.json'] ?? ''),
      TO,
    );
    expect(again.plan.changes).toEqual([]);
  });

  it('leaves an app that already has both files alone, with a warning', async () => {
    const both =
      '{\n  "name": "cart",\n  "owner": "team-new",\n  "shells": ["shell"],\n  "routes": ["/cart"],\n  "exposes": ["./App"]\n}\n';
    const { root, project } = await oldProject({ 'apps/cart/mfeflow.app.json': both });
    const up = await planProjectUpgrade(ctx, root, project, TO);
    const paths = up.plan.changes.map((c) => c.path);
    expect(paths).not.toContain('apps/cart/mfe.json');
    expect(paths).not.toContain('apps/cart/mfeflow.app.json');
    expect(paths).toContain('apps/catalog/mfeflow.app.json');
    expect(up.plan.warnings).toContain(
      'apps/cart has both mfe.json and mfeflow.app.json; keep mfeflow.app.json and delete mfe.json (E122)',
    );
  });
});
