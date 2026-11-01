import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FeatureManifest } from '@mfeflow/contracts';
import { applyPlan } from './apply';
import type { LoadedFeature } from './features/load';
import { hashContent } from './hash';
import { parseJsonObject } from './json';
import type { PlanBuilder } from './plan';
import type { MfeflowProject } from './project';
import { rejection } from './testing';
import { detectBaseline, planUpgrade, type UpgradeInput } from './upgrade';

const parse = (text: string | null | undefined) => parseJsonObject('test', text ?? '{}');
const isStructuredPath = (file: string) =>
  file.endsWith('package.json') || file.endsWith('.yaml') || file === 'turbo.json';
const json = (value: object) => `${JSON.stringify(value, null, 2)}\n`;

const WORKSPACE = [
  'packages:',
  '  - apps/*',
  'catalog:',
  '  zod: 4.0.0',
  'allowBuilds:',
  '  lefthook: true',
  '',
].join('\n');
const WORKSPACE_NEW = [
  'packages:',
  '  - apps/*',
  'catalog:',
  '  zod: 4.1.0',
  '  react: 19.0.0',
  'allowBuilds:',
  '  lefthook: true',
  '  esbuild: false',
  '',
].join('\n');

const TURBO = json({ tasks: { build: { dependsOn: ['^build'] } } });
const TURBO_NEW = json({
  tasks: { build: { dependsOn: ['^build'], outputs: ['dist/**'] }, lint: {} },
});

const pkg = (extra: object) => json({ name: 'root', private: true, ...extra });

/** What the old version generated. */
const OLD: Record<string, string> = {
  'package.json': pkg({
    devDependencies: { '@mfeflow/tsconfig': '^0.1.0', zod: 'catalog:' },
    scripts: { build: 'turbo build' },
    custom: { keep: true },
  }),
  'pnpm-workspace.yaml': WORKSPACE,
  'turbo.json': TURBO,
  'apps/shell/package.json': json({
    name: '@shop/shell',
    dependencies: { '@mfeflow/runtime': '^0.1.0' },
  }),
  'README.md': 'old readme\n',
  'src/config.ts': 'old config\n',
  'src/dropped.ts': 'gone in the new version\n',
  'registry/envs/prod/cart.json': json({ version: '0.0.0' }),
  'env.ts': 'old env\n',
};

const NEW: Record<string, string> = {
  'package.json': pkg({
    devDependencies: {
      '@mfeflow/tsconfig': 'latest',
      '@mfeflow/oxlint-config': 'latest',
      zod: 'catalog:',
      react: 'catalog:',
    },
    scripts: { build: 'turbo build', doctor: 'mfeflow doctor' },
  }),
  'pnpm-workspace.yaml': WORKSPACE_NEW,
  'turbo.json': TURBO_NEW,
  'apps/shell/package.json': json({
    name: '@shop/shell',
    dependencies: { '@mfeflow/runtime': 'latest' },
  }),
  'README.md': 'new readme\n',
  'src/config.ts': 'new config\n',
  'src/added.ts': 'added\n',
  'registry/envs/prod/cart.json': json({ version: '0.0.0' }),
  'env.ts': 'new env\n',
};

function feature(
  name: string,
  version: string,
  files: Record<string, string>,
  extra: Partial<FeatureManifest> = {},
  dir?: string,
): LoadedFeature {
  const manifest: FeatureManifest = {
    name,
    version,
    files: Object.entries(files).map(([to, content]) => ({ to, content, target: 'root' })),
    ...extra,
  };
  const out: LoadedFeature = { manifest, trust: 'first-party' };
  if (dir) out.dir = dir;
  return out;
}

/** The new version as one `core` feature, with the shell's package.json targeted at the shell. */
function newCore(extra: Partial<FeatureManifest> = {}, dir?: string): LoadedFeature {
  const { 'apps/shell/package.json': shellPkg, ...root } = NEW;
  const loaded = feature('core', '0.2.0', root, extra, dir);
  loaded.manifest.files?.push({ to: 'package.json', target: 'shell', content: shellPkg ?? '' });
  return loaded;
}

function projectOf(
  files: Record<string, string>,
  extra: Partial<MfeflowProject> = {},
): MfeflowProject {
  const tracked = Object.fromEntries(
    Object.entries(files)
      .filter(([file]) => file !== 'mfeflow.json')
      .map(([file, content]) => [file, hashContent(content)]),
  );
  return {
    version: 1,
    topology: 'monorepo',
    packageManager: 'pnpm',
    scope: '@shop',
    apps: { shell: { kind: 'shell', path: 'apps/shell' } },
    features: { core: { version: '0.1.0' } },
    files: tracked,
    ...extra,
  };
}

function input(disk: Record<string, string>, extra: Partial<UpgradeInput> = {}): UpgradeInput {
  return {
    toVersion: '0.5.0',
    read: (file) => Promise.resolve(disk[file]),
    features: [newCore()],
    ...extra,
  };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('detectBaseline', () => {
  const read = (files: Record<string, string>) => (file: string) => Promise.resolve(files[file]);
  const shellWith = (range: string) =>
    json({ name: 'shell', dependencies: { '@mfeflow/runtime': range } });

  it('takes cli from mfeflow.json first', async () => {
    const project = projectOf({}, { cli: '0.3.0' });
    expect(await detectBaseline(project, read({}))).toEqual({
      version: '0.3.0',
      source: 'mfeflow.json',
    });
  });

  it('infers it from the shell runtime range when cli is missing', async () => {
    const found = await detectBaseline(
      projectOf({}),
      read({ 'apps/shell/package.json': shellWith('^0.1.0') }),
    );
    expect(found).toEqual({ version: '0.1.0', source: 'package.json' });
  });

  it('follows a catalog: range into the workspace file', async () => {
    const files = {
      'apps/shell/package.json': shellWith('catalog:'),
      'pnpm-workspace.yaml': 'catalog:\n  "@mfeflow/runtime": ^0.2.1\n',
    };
    const found = await detectBaseline(projectOf({}), read(files));
    expect(found.version).toBe('0.2.1');
  });

  it('looks past an app without the runtime to one that has it', async () => {
    const project = projectOf(
      {},
      {
        apps: {
          shell: { kind: 'shell', path: 'apps/shell' },
          cart: { kind: 'remote', path: 'apps/cart' },
        },
      },
    );
    const found = await detectBaseline(
      project,
      read({
        'apps/shell/package.json': json({ name: 'shell' }),
        'apps/cart/package.json': shellWith('~0.1.4'),
      }),
    );
    expect(found.version).toBe('0.1.4');
  });

  it.each(['workspace:*', 'link:../mfeflow/packages/runtime', 'latest', '*', 'x', '>=0'])(
    'refuses a %s range with E601',
    async (range) => {
      const error = await rejection(
        detectBaseline(projectOf({}), read({ 'apps/shell/package.json': shellWith(range) })),
      );
      expect(error.code).toBe('MFEFLOW_E601');
    },
  );

  it('takes the lowest version of a range with alternatives', async () => {
    const found = await detectBaseline(
      projectOf({}),
      read({ 'apps/shell/package.json': shellWith('^0.1.0 || ^0.2.0') }),
    );
    expect(found.version).toBe('0.1.0');
  });

  it('accepts a prerelease cli, and refuses to move from a release back to a prerelease', async () => {
    const pre = projectOf({}, { cli: '0.5.0-beta.1' });
    expect((await detectBaseline(pre, read({}))).version).toBe('0.5.0-beta.1');
    const up = await planUpgrade(projectOf(OLD, { cli: '0.5.0-beta.1' }), input(OLD));
    expect(up.from).toBe('0.5.0-beta.1');
    const error = await rejection(
      planUpgrade(projectOf(OLD, { cli: '0.5.0' }), { ...input(OLD), toVersion: '0.5.0-beta.1' }),
    );
    expect(error.code).toBe('MFEFLOW_E602');
  });

  it('refuses when nothing says which version made the project', async () => {
    const error = await rejection(detectBaseline(projectOf({}), read({})));
    expect(error.code).toBe('MFEFLOW_E601');
  });
});

describe('planUpgrade', () => {
  const project = () => projectOf(OLD);

  it('replaces unmodified files, creates new ones and leaves everything else', async () => {
    const up = await planUpgrade(project(), input(OLD));
    const byPath = Object.fromEntries(up.plan.changes.map((c) => [c.path, c]));
    expect(byPath['README.md']).toMatchObject({ action: 'patch', after: 'new readme\n' });
    expect(byPath['src/config.ts']).toMatchObject({ action: 'patch', after: 'new config\n' });
    expect(byPath['src/added.ts']).toMatchObject({
      action: 'create',
      after: 'added\n',
      track: true,
    });
    expect(up.from).toBe('0.1.0');
    expect(up.fromSource).toBe('package.json');
  });

  it('flags a file you edited with a diff and does not write it', async () => {
    const disk = { ...OLD, 'src/config.ts': 'my own config\n' };
    const up = await planUpgrade(projectOf(OLD), input(disk));
    expect(up.plan.changes.map((c) => c.path)).not.toContain('src/config.ts');
    expect(up.diverged).toHaveLength(2);
    const config = up.diverged.find((d) => d.path === 'src/config.ts');
    expect(config).toMatchObject({
      reason: 'edited',
      yours: 'my own config\n',
      incoming: 'new config\n',
    });
    expect(config?.diff).toContain('-my own config');
    expect(config?.diff).toContain('+new config');
  });

  it('never overwrites a file the CLI edits after generating it', async () => {
    const up = await planUpgrade(projectOf(OLD), input(OLD));
    expect(up.diverged.map((d) => [d.path, d.reason])).toEqual([['env.ts', 'edited-by-cli']]);
    expect(up.plan.changes.map((c) => c.path)).not.toContain('env.ts');
  });

  it('flags an untracked file that differs and leaves one that matches', async () => {
    const disk = { ...OLD, 'src/added.ts': 'mine\n' };
    const up = await planUpgrade(projectOf(OLD), input(disk));
    expect(up.diverged.find((d) => d.path === 'src/added.ts')?.reason).toBe('untracked');
    const same = await planUpgrade(projectOf(OLD), input({ ...OLD, 'src/added.ts': 'added\n' }));
    expect(same.diverged.map((d) => d.path)).not.toContain('src/added.ts');
    expect(same.plan.changes.map((c) => c.path)).not.toContain('src/added.ts');
  });

  it('does not bring back a tracked file you deleted', async () => {
    const { 'README.md': _gone, ...disk } = OLD;
    const up = await planUpgrade(projectOf(OLD), input(disk));
    expect(up.missing).toEqual(['README.md']);
    expect(up.plan.changes.map((c) => c.path)).not.toContain('README.md');
  });

  it('reports files the new version dropped and never deletes them', async () => {
    const up = await planUpgrade(project(), input(OLD));
    expect(up.removed).toEqual(['src/dropped.ts']);
    expect(up.plan.changes.some((c) => c.action === 'delete')).toBe(false);
  });

  it('stays quiet about removed files when a feature could not be replayed', async () => {
    const skipped = [{ name: 'forms', reason: 'not found' }];
    const up = await planUpgrade(project(), input(OLD, { skipped }));
    expect(up.removed).toEqual([]);
    expect(up.plan.warnings).toEqual([
      'forms was not replayed (not found); its files were left as they are',
    ]);
  });

  it('keeps registry entries as they are', async () => {
    const disk = { ...OLD, 'registry/envs/prod/cart.json': json({ version: '1.4.2' }) };
    const up = await planUpgrade(projectOf(OLD), input(disk));
    expect(up.plan.changes.map((c) => c.path)).not.toContain('registry/envs/prod/cart.json');
    expect(up.diverged.map((d) => d.path)).not.toContain('registry/envs/prod/cart.json');
    expect(up.removed).not.toContain('registry/envs/prod/cart.json');
  });

  it('edits package.json structurally and keeps every other field and key order', async () => {
    const up = await planUpgrade(project(), input(OLD));
    const change = up.plan.changes.find((c) => c.path === 'package.json');
    const after = parse(change?.after);
    expect(Object.keys(after)).toEqual(['name', 'private', 'devDependencies', 'scripts', 'custom']);
    expect(after.custom).toEqual({ keep: true });
    expect(after.devDependencies).toEqual({
      '@mfeflow/oxlint-config': '^0.5.0',
      '@mfeflow/tsconfig': '^0.5.0',
      react: 'catalog:',
      zod: 'catalog:',
    });
    expect(after.scripts).toEqual({ build: 'turbo build', doctor: 'mfeflow doctor' });
    expect(up.plan.scripts).toEqual([
      { file: 'package.json', name: 'doctor', command: 'mfeflow doctor' },
    ]);
    const shell = up.plan.changes.find((c) => c.path === 'apps/shell/package.json');
    expect(parse(shell?.after).dependencies).toEqual({ '@mfeflow/runtime': '^0.5.0' });
  });

  it('keeps your own script and dependency choices', async () => {
    const mine = pkg({
      devDependencies: { '@mfeflow/tsconfig': '^0.1.0', zod: '^3.0.0' },
      scripts: { build: 'my build', doctor: 'my doctor' },
    });
    const up = await planUpgrade(projectOf(OLD), input({ ...OLD, 'package.json': mine }));
    const after = parse(up.plan.changes.find((c) => c.path === 'package.json')?.after);
    expect(after.scripts).toEqual({ build: 'my build', doctor: 'my doctor' });
    expect(after.devDependencies).toHaveProperty('zod', '^3.0.0');
  });

  it('adds only new catalog entries and allowBuilds rules to the workspace file', async () => {
    const up = await planUpgrade(project(), input(OLD));
    const after = up.plan.changes.find((c) => c.path === 'pnpm-workspace.yaml')?.after ?? '';
    expect(after).toContain('react: 19.0.0');
    expect(after).toContain('esbuild: false');
    expect(after).toContain('zod: 4.0.0');
    expect(after).not.toContain('4.1.0');
  });

  it('adds only missing tasks to turbo.json', async () => {
    const up = await planUpgrade(project(), input(OLD));
    const after = parse(up.plan.changes.find((c) => c.path === 'turbo.json')?.after);
    expect(after.tasks).toEqual({ build: { dependsOn: ['^build'] }, lint: {} });
  });

  it('moves a catalog-held @mfeflow range in the workspace file', async () => {
    const files = {
      ...OLD,
      'apps/shell/package.json': json({
        name: '@shop/shell',
        dependencies: { '@mfeflow/runtime': 'catalog:' },
      }),
      'pnpm-workspace.yaml': WORKSPACE.replace(
        'catalog:\n',
        'catalog:\n  "@mfeflow/runtime": ^0.1.0\n',
      ),
    };
    const up = await planUpgrade(projectOf(files, { cli: '0.1.0' }), input(files));
    const after = up.plan.changes.find((c) => c.path === 'pnpm-workspace.yaml')?.after ?? '';
    expect(after).toMatch(/"@mfeflow\/runtime": \^0\.5\.0/);
  });

  it('leaves link: and workspace: ranges alone', async () => {
    const files = {
      ...OLD,
      'apps/shell/package.json': json({
        name: '@shop/shell',
        dependencies: { '@mfeflow/runtime': 'workspace:*', '@mfeflow/http': 'link:../x' },
      }),
    };
    const up = await planUpgrade(projectOf(files, { cli: '0.1.0' }), input(files));
    expect(up.plan.changes.map((c) => c.path)).not.toContain('apps/shell/package.json');
  });

  it('does not touch @mfeflow ranges of a project linked with --local', async () => {
    const up = await planUpgrade(projectOf(OLD, { cli: '0.1.0', local: '../mfeflow' }), input(OLD));
    const root = up.plan.changes.find((c) => c.path === 'package.json')?.after ?? '';
    expect(root).toContain('"@mfeflow/tsconfig": "^0.1.0"');
    expect(root).not.toContain('oxlint-config');
  });

  it('never replaces a file a skipped feature may have patched', async () => {
    const withThird = projectOf(OLD, {
      features: { core: { version: '0.1.0' }, '@acme/seo': { version: '1.0.0' } },
    });
    const skipped = [{ name: '@acme/seo', reason: 'registry unreachable' }];
    const up = await planUpgrade(withThird, input(OLD, { skipped }));
    expect(
      up.plan.changes.filter((c) => c.action === 'patch' && !isStructuredPath(c.path)),
    ).toEqual([]);
    expect(up.diverged.find((d) => d.path === 'README.md')?.reason).toBe('skipped-feature');
    expect(up.diverged.find((d) => d.path === 'src/config.ts')?.reason).toBe('skipped-feature');
    expect(up.plan.warnings.join(' ')).toContain('@acme/seo');
  });

  it('updates a dependency in every section that lists it', async () => {
    const both = pkg({
      dependencies: { '@mfeflow/tsconfig': '^0.1.0' },
      devDependencies: { '@mfeflow/tsconfig': '^0.1.0' },
    });
    const up = await planUpgrade(
      projectOf(OLD, { cli: '0.1.0' }),
      input({ ...OLD, 'package.json': both }),
    );
    const after = parse(up.plan.changes.find((c) => c.path === 'package.json')?.after);
    expect(after.dependencies).toEqual({ '@mfeflow/tsconfig': '^0.5.0' });
    expect(after.devDependencies).toMatchObject({ '@mfeflow/tsconfig': '^0.5.0' });
  });

  it('still updates the second section when the first already has the target', async () => {
    const split = pkg({
      dependencies: { '@mfeflow/tsconfig': '^0.5.0' },
      devDependencies: { '@mfeflow/tsconfig': '^0.1.0' },
    });
    const up = await planUpgrade(
      projectOf(OLD, { cli: '0.1.0' }),
      input({ ...OLD, 'package.json': split }),
    );
    const after = parse(up.plan.changes.find((c) => c.path === 'package.json')?.after);
    expect(after.dependencies).toEqual({ '@mfeflow/tsconfig': '^0.5.0' });
    expect(after.devDependencies).toMatchObject({ '@mfeflow/tsconfig': '^0.5.0' });
  });

  it('does not write a placeholder range into the catalog of a linked project', async () => {
    const own = [
      'packages:',
      '  - apps/*',
      'catalog:',
      '  zod: 4.0.0',
      '  "@mfeflow/runtime": latest',
      '',
    ].join('\n');
    const core = newCore();
    for (const f of core.manifest.files ?? []) {
      if (f.to === 'pnpm-workspace.yaml') f.content = own;
    }
    const linked = projectOf(OLD, { cli: '0.1.0', local: '../mfeflow' });
    const up = await planUpgrade(linked, { ...input(OLD), features: [core] });
    const after = up.plan.changes.find((c) => c.path === 'pnpm-workspace.yaml')?.after ?? '';
    expect(after).not.toContain('@mfeflow/runtime');
    expect(after).not.toContain('latest');
  });

  it('reports a tracked symlink instead of replacing it', async () => {
    const up = await planUpgrade(
      project(),
      input(OLD, { isSymlink: (file) => Promise.resolve(file === 'README.md') }),
    );
    expect(up.diverged.find((d) => d.path === 'README.md')?.reason).toBe('symlink');
    expect(up.plan.changes.map((c) => c.path)).not.toContain('README.md');
    expect(up.plan.changes.map((c) => c.path)).toContain('src/config.ts');
  });

  it('keeps CRLF line endings in a file it replaces or edits', async () => {
    const crlf = (text: string) => text.replaceAll('\n', '\r\n');
    const disk = {
      ...OLD,
      'README.md': crlf(OLD['README.md'] ?? ''),
      'package.json': crlf(OLD['package.json'] ?? ''),
    };
    const up = await planUpgrade(projectOf(OLD), input(disk));
    const byPath = Object.fromEntries(up.plan.changes.map((c) => [c.path, c.after]));
    expect(byPath['README.md']).toBe('new readme\r\n');
    expect(byPath['package.json']).toContain('\r\n');
    expect(byPath['package.json']?.replaceAll('\r\n', '')).not.toContain('\n');
    expect(byPath['src/config.ts']).toBe('new config\n');
  });

  it('records cli, feature versions and fresh hashes', async () => {
    const root = await tempProject(OLD);
    const up = await planUpgrade(projectOf(OLD), {
      toVersion: '0.5.0',
      read: async (file) => fs.readFile(path.join(root, file), 'utf8').catch(() => undefined),
      features: [newCore()],
    });
    expect(up.project.cli).toBe('0.5.0');
    const result = await applyPlan(up.plan, { root, project: up.project });
    expect(result.project?.features.core?.version).toBe('0.2.0');
    expect(result.project?.files?.['README.md']).toBe(hashContent('new readme\n'));
    expect(result.project?.files?.['src/added.ts']).toBe(hashContent('added\n'));
    expect(result.project?.files?.['src/config.ts']).toBe(hashContent('new config\n'));
  });

  it('writes nothing on a dry run, and nothing while planning', async () => {
    const root = await tempProject(OLD);
    const before = await snapshot(root);
    const up = await planUpgrade(projectOf(OLD), {
      toVersion: '0.5.0',
      read: async (file) => fs.readFile(path.join(root, file), 'utf8').catch(() => undefined),
      features: [newCore()],
    });
    expect(await snapshot(root)).toEqual(before);
    const result = await applyPlan(up.plan, { root, project: up.project, dryRun: true });
    expect(result.written).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
  });

  it('rolls everything back when applying fails', async () => {
    const root = await tempProject(OLD);
    const up = await planUpgrade(projectOf(OLD), {
      toVersion: '0.5.0',
      read: async (file) => fs.readFile(path.join(root, file), 'utf8').catch(() => undefined),
      features: [newCore()],
    });
    const before = await snapshot(root);
    const error = await rejection(
      applyPlan(up.plan, {
        root,
        project: up.project,
        install: () => Promise.reject(new Error('offline')),
      }),
    );
    expect(error.code).toBe('MFEFLOW_E213');
    expect(await snapshot(root)).toEqual(before);
  });

  it('refuses to move a project backwards', async () => {
    const error = await rejection(planUpgrade(projectOf(OLD, { cli: '0.9.0' }), input(OLD)));
    expect(error.code).toBe('MFEFLOW_E602');
  });

  it('drops recorded options the new feature no longer has, with a warning', async () => {
    const files = { ...OLD };
    const up = await planUpgrade(
      projectOf(files, { features: { core: { version: '0.1.0', options: { gone: true } } } }),
      input(files),
    );
    expect(up.plan.warnings).toEqual(['core no longer has the option "gone"; it was ignored']);
  });
});

const envTs = (keys: string[]) =>
  [
    "import { createEnv } from '@t3-oss/env-core';",
    "import { z } from 'zod';",
    'export const env = createEnv({',
    '  server: {',
    ...keys.map((key) => `    ${key}: z.string(),`),
    '  },',
    '  runtimeEnv: process.env,',
    '});',
    '',
  ].join('\n');

describe('files the CLI adds keys to', () => {
  const run = (disk: string, incoming: string, recordedAs = disk) => {
    const files = {
      'env.ts': disk,
      'apps/shell/package.json': OLD['apps/shell/package.json'] ?? '',
    };
    const project = projectOf({ 'env.ts': recordedAs }, { cli: '0.1.0' });
    return planUpgrade(project, {
      ...input(files),
      features: [feature('core', '0.2.0', { 'env.ts': incoming })],
    });
  };

  it('replaces the file when your keys are all still in the new version', async () => {
    const up = await run(envTs(['A']), envTs(['A', 'B']));
    expect(up.diverged).toEqual([]);
    expect(up.plan.changes.find((c) => c.path === 'env.ts')?.after).toBe(envTs(['A', 'B']));
  });

  it('flags the file with the keys you would lose', async () => {
    const up = await run(envTs(['A', 'MINE']), envTs(['A', 'B']));
    expect(up.diverged).toHaveLength(1);
    expect(up.diverged[0]).toMatchObject({
      path: 'env.ts',
      reason: 'edited-by-cli',
      lostKeys: ['MINE'],
    });
    expect(up.plan.changes.map((c) => c.path)).not.toContain('env.ts');
  });

  it('calls a file edited by hand edited, even when it has keys', async () => {
    const up = await run(envTs(['A', 'MINE']), envTs(['A', 'B']), envTs(['A']));
    expect(up.diverged[0]).toMatchObject({ reason: 'edited', lostKeys: ['MINE'] });
  });

  it('reads dotenv and runtime-config files the same way', async () => {
    const dotenv = projectOf({ '.env.example': 'A=1\nMINE=2\n' }, { cli: '0.1.0' });
    const runtime = projectOf(
      { 'apps/shell/public/config/runtime-config.dev.json': '{"a":1,"mine":2}\n' },
      { cli: '0.1.0' },
    );
    const shell = { 'apps/shell/package.json': OLD['apps/shell/package.json'] ?? '' };
    const a = await planUpgrade(dotenv, {
      ...input({ ...shell, '.env.example': 'A=1\nMINE=2\n' }),
      features: [feature('core', '0.2.0', { '.env.example': 'A=1\n' })],
    });
    expect(a.diverged[0]).toMatchObject({ reason: 'edited-by-cli', lostKeys: ['MINE'] });
    const b = await planUpgrade(runtime, {
      ...input({
        ...shell,
        'apps/shell/public/config/runtime-config.dev.json': '{"a":1,"mine":2}\n',
      }),
      features: [
        feature('core', '0.2.0', {
          'apps/shell/public/config/runtime-config.dev.json': '{"a":1}\n',
        }),
      ],
    });
    expect(b.diverged[0]).toMatchObject({ reason: 'edited-by-cli', lostKeys: ['mine'] });
  });
});

describe('decisions', () => {
  const disk = { ...OLD, 'src/config.ts': 'my own config\n', 'README.md': 'my readme\n' };
  const plan = (decisions: UpgradeInput['decisions'], project = projectOf(OLD)) =>
    planUpgrade(project, { ...input(disk), ...(decisions ? { decisions } : {}) });

  it('writes an accepted file with the new version and records its hash', async () => {
    const up = await plan({ accept: new Set(['src/config.ts']) });
    const change = up.plan.changes.find((c) => c.path === 'src/config.ts');
    expect(change).toMatchObject({
      action: 'patch',
      before: 'my own config\n',
      after: 'new config\n',
    });
    expect(up.diverged.find((d) => d.path === 'src/config.ts')?.decision).toBe('accept');
    expect(up.diverged.find((d) => d.path === 'README.md')?.decision).toBeUndefined();
    expect(up.project.files?.['src/config.ts']).toBe(hashContent('new config\n'));
  });

  it('leaves a kept file alone and remembers the version it was kept against', async () => {
    const up = await plan({ keep: new Set(['src/config.ts']) });
    expect(up.plan.changes.map((c) => c.path)).not.toContain('src/config.ts');
    expect(up.diverged.find((d) => d.path === 'src/config.ts')?.decision).toBe('keep');
    expect(up.project.files?.['src/config.ts']).toBe(hashContent('my own config\n'));
    expect(up.project.kept).toEqual({ 'src/config.ts': hashContent('new config\n') });
  });

  it('never replaces a kept file on a later run, and raises it again only when the new version changes', async () => {
    const first = await plan({ keep: 'all' });
    const second = await planUpgrade(first.project, input(disk));
    expect(second.plan.changes.map((c) => c.path)).not.toContain('src/config.ts');
    expect(second.plan.changes.map((c) => c.path)).not.toContain('README.md');
    expect(second.diverged.map((d) => d.path)).not.toContain('src/config.ts');
    const newer = feature('core', '0.3.0', { ...NEW, 'src/config.ts': 'newer config\n' });
    const third = await planUpgrade(first.project, { ...input(disk), features: [newer] });
    expect(third.plan.changes.map((c) => c.path)).not.toContain('src/config.ts');
    expect(third.diverged.find((d) => d.path === 'src/config.ts')).toMatchObject({
      reason: 'edited',
      incoming: 'newer config\n',
    });
  });

  it('lets an accept clear an earlier keep', async () => {
    const kept = await plan({ keep: 'all' });
    const newer = feature('core', '0.3.0', { ...NEW, 'src/config.ts': 'newer config\n' });
    const up = await planUpgrade(kept.project, {
      ...input(disk),
      features: [newer],
      decisions: { accept: new Set(['src/config.ts']) },
    });
    expect(up.project.kept?.['src/config.ts']).toBeUndefined();
    expect(up.project.files?.['src/config.ts']).toBe(hashContent('newer config\n'));
  });

  it('takes `all` as every file but a symlink', async () => {
    const up = await planUpgrade(projectOf(OLD), {
      ...input({ ...OLD, 'src/config.ts': 'my own config\n' }),
      decisions: { accept: 'all' },
      isSymlink: (file) => Promise.resolve(file === 'README.md'),
    });
    const decisions = Object.fromEntries(up.diverged.map((d) => [d.path, d.decision]));
    expect(decisions['src/config.ts']).toBe('accept');
    expect(decisions['README.md']).toBeUndefined();
    expect(up.diverged.find((d) => d.path === 'README.md')?.reason).toBe('symlink');
  });

  it('lets a named path beat `all` in the other list', async () => {
    const up = await plan({ accept: 'all', keep: new Set(['README.md']) });
    const decisions = Object.fromEntries(up.diverged.map((d) => [d.path, d.decision]));
    expect(decisions['README.md']).toBe('keep');
    expect(decisions['src/config.ts']).toBe('accept');
  });

  it('keeps CRLF in an accepted file', async () => {
    const crlf = { ...disk, 'src/config.ts': 'my\r\nconfig\r\n' };
    const up = await planUpgrade(projectOf(OLD), {
      ...input(crlf),
      decisions: { accept: new Set(['src/config.ts']) },
    });
    expect(up.plan.changes.find((c) => c.path === 'src/config.ts')?.after).toBe('new config\r\n');
  });
});

describe('trust, symlinks and unchanged templates', () => {
  it('keeps the trust of a third-party feature on the files it writes', async () => {
    const thirdParty: LoadedFeature = {
      ...feature('@acme/hello', '1.0.0', { 'src/hello.ts': 'hello\n' }),
      trust: 'third-party',
    };
    const up = await planUpgrade(projectOf(OLD), {
      ...input(OLD),
      features: [newCore(), thirdParty],
    });
    const trust = Object.fromEntries(up.plan.changes.map((c) => [c.path, c.trust]));
    expect(trust['src/hello.ts']).toBe('third-party');
    expect(trust['README.md']).toBe('first-party');
  });

  describe('a file a third-party feature touches', () => {
    const acme = (extra: Partial<FeatureManifest>): LoadedFeature => ({
      manifest: { name: '@acme/hello', version: '1.0.0', ...extra },
      trust: 'third-party',
    });
    const addImport = {
      op: 'add-import' as const,
      file: 'src/main.ts',
      target: 'root',
      from: 'left-pad',
      named: ['pad'],
    };
    const MAIN = 'export const main = 1;\n';
    const disk = { ...OLD, 'src/main.ts': MAIN };
    const run = (third: LoadedFeature) =>
      planUpgrade(projectOf(disk), {
        ...input(disk),
        features: [
          newCore({}, undefined),
          feature('base', '1.0.0', { 'src/main.ts': MAIN }),
          third,
        ],
      });
    const trustOf = (up: Awaited<ReturnType<typeof run>>, file: string) =>
      up.plan.changes.find((c) => c.path === file)?.trust;

    it('keeps third-party trust on a first-party file the feature patched', async () => {
      const up = await run(acme({ transforms: [addImport] }));
      expect(up.plan.changes.find((c) => c.path === 'src/main.ts')?.after).toContain('left-pad');
      expect(trustOf(up, 'src/main.ts')).toBe('third-party');
    });

    it('keeps it on a file both a first-party and a third-party feature write to', async () => {
      const up = await run(
        acme({
          dependencies: [{ name: 'left-pad', range: '^1.0.0', target: 'root' }],
        }),
      );
      expect(trustOf(up, 'package.json')).toBe('third-party');
      expect(trustOf(up, 'README.md')).toBe('first-party');
    });

    it('marks the dependencies it declared as third-party, and no other', async () => {
      const up = await run(
        acme({ dependencies: [{ name: 'left-pad', range: '^1.0.0', target: 'root' }] }),
      );
      const flags = Object.fromEntries(
        up.plan.dependencies.map((d) => [d.name, d.thirdParty === true]),
      );
      expect(flags['left-pad']).toBe(true);
      expect(Object.entries(flags).filter(([name]) => name !== 'left-pad')).toSatisfy(
        (rest: [string, boolean][]) => rest.every(([, third]) => !third),
      );
    });
  });

  it('never offers a symlink for writing, edited or not, even with accept all', async () => {
    const disk = { ...OLD, 'README.md': 'my readme\n' };
    const up = await planUpgrade(projectOf(OLD), {
      ...input(disk),
      decisions: { accept: 'all' },
      isSymlink: (file) => Promise.resolve(file === 'README.md'),
    });
    expect(up.diverged.find((d) => d.path === 'README.md')).toMatchObject({ reason: 'symlink' });
    expect(up.diverged.find((d) => d.path === 'README.md')?.decision).toBeUndefined();
    expect(up.plan.changes.map((c) => c.path)).not.toContain('README.md');
  });

  it('does not offer a file you edited when the new version generates what the old one did', async () => {
    const same = { ...OLD, 'src/config.ts': 'old config\n' };
    const files = { ...NEW, 'src/config.ts': 'old config\n' };
    const up = await planUpgrade(projectOf(same), {
      ...input({ ...same, 'src/config.ts': 'my own config\n' }),
      features: [feature('core', '0.2.0', files)],
    });
    expect(up.diverged.map((d) => d.path)).not.toContain('src/config.ts');
    expect(up.plan.changes.map((c) => c.path)).not.toContain('src/config.ts');
  });

  describe('a key whose value differs from the new version', () => {
    const withValue = (schema: string) => envTs(['A']).replace('A: z.string()', `A: ${schema}`);
    const shell = { 'apps/shell/package.json': OLD['apps/shell/package.json'] ?? '' };
    const plan = (disk: string, recorded: string) =>
      planUpgrade(projectOf({ 'env.ts': recorded }, { cli: '0.1.0' }), {
        ...input({ 'env.ts': disk, ...shell }),
        features: [feature('core', '0.2.0', { 'env.ts': withValue('z.string().min(1)') })],
      });

    it('is counted as lost when you changed the file', async () => {
      const disk = withValue('z.string().min(3)');
      const up = await plan(disk, envTs(['A']));
      expect(up.diverged[0]).toMatchObject({
        reason: 'edited',
        lostKeys: ['A'],
        changedValues: ['A'],
      });
    });

    it('takes the new template when the file is untouched since it was written', async () => {
      const disk = withValue('z.string().min(3)');
      const up = await plan(disk, disk);
      expect(up.diverged).toEqual([]);
      expect(up.plan.changes.find((c) => c.path === 'env.ts')?.after).toBe(
        withValue('z.string().min(1)'),
      );
    });

    it('says so when it replaces a value that may be one you set with add env-key', async () => {
      const disk = withValue('z.string().min(3)');
      const up = await plan(disk, disk);
      expect(up.plan.warnings).toEqual([
        expect.stringContaining('env.ts: the values of A change to the new version'),
      ]);
    });

    it('lists the changed values too when a missing key stops the replacement', async () => {
      const disk = withValue('z.string().min(3)').replace(
        '  },\n  runtimeEnv',
        '    MINE: z.string(),\n  },\n  runtimeEnv',
      );
      const up = await plan(disk, disk);
      expect(up.diverged[0]).toMatchObject({
        reason: 'edited-by-cli',
        lostKeys: ['A', 'MINE'],
        changedValues: ['A'],
      });
    });

    it('still protects a key you added to an untouched-looking file, and names it a key, not a value', async () => {
      const disk = withValue('z.string().min(1)').replace(
        '  },\n  runtimeEnv',
        '    MINE: z.string(),\n  },\n  runtimeEnv',
      );
      const up = await plan(disk, disk);
      expect(up.diverged[0]).toMatchObject({ reason: 'edited-by-cli', lostKeys: ['MINE'] });
      expect(up.diverged[0]?.changedValues).toBeUndefined();
    });
  });
});

describe('migrations', () => {
  const calls: string[] = [];
  const modules: Record<string, (b: PlanBuilder) => Promise<void>> = {
    '/f/m1.mjs': async (b) => {
      calls.push('0.2.0');
      await b.create('migrated-one.txt', '1');
    },
    '/f/m2.mjs': async (b) => {
      calls.push('0.3.0');
      await b.create('migrated-two.txt', '2');
    },
    '/f/old.mjs': async () => {
      calls.push('0.1.5');
    },
  };
  const importModule = (file: string) => {
    const migrate = modules[file.split(path.sep).join('/')];
    return migrate ? Promise.resolve({ default: migrate }) : Promise.reject(new Error('no module'));
  };
  const migrations = [
    { from: '0.2.0', to: '0.3.0', module: 'm2.mjs' },
    { from: '0.1.0', to: '0.2.0', module: 'm1.mjs' },
    { from: '0.1.0', to: '0.1.5', module: 'old.mjs' },
    { from: '0.3.0', to: '0.4.0', module: 'future.mjs' },
  ];
  const withMigrations = (version: string, recorded: string) =>
    [
      projectOf(OLD, { features: { core: { version: recorded } } }),
      input(OLD, {
        importModule,
        features: [
          {
            ...newCore({ migrations }, '/f'),
            manifest: { ...newCore({ migrations }, '/f').manifest, version },
          },
        ],
      }),
    ] as const;

  it('runs the migrations the upgrade crosses, in version order, on the same plan', async () => {
    calls.length = 0;
    const [project, upgrade] = withMigrations('0.3.0', '0.1.0');
    const up = await planUpgrade(project, upgrade);
    expect(calls).toEqual(['0.1.5', '0.2.0', '0.3.0']);
    expect(
      up.plan.changes.filter((c) => c.path.startsWith('migrated-')).map((c) => c.path),
    ).toEqual(['migrated-one.txt', 'migrated-two.txt']);
    expect(up.migrations).toEqual([
      { feature: 'core', from: '0.1.0', to: '0.1.5' },
      { feature: 'core', from: '0.1.0', to: '0.2.0' },
      { feature: 'core', from: '0.2.0', to: '0.3.0' },
    ]);
  });

  it('skips a migration the project already has, and one the new version does not reach', async () => {
    calls.length = 0;
    const [project, upgrade] = withMigrations('0.3.0', '0.2.0');
    await planUpgrade(project, upgrade);
    expect(calls).toEqual(['0.3.0']);
  });

  it('reports a module that cannot be loaded as E603', async () => {
    const [project, upgrade] = withMigrations('0.4.0', '0.3.0');
    const error = await rejection(planUpgrade(project, upgrade));
    expect(error.code).toBe('MFEFLOW_E603');
    expect(error.message).toContain('future.mjs');
  });

  it('reports a module without a function as E603', async () => {
    const [project, upgrade] = withMigrations('0.2.0', '0.1.0');
    const error = await rejection(
      planUpgrade(project, { ...upgrade, importModule: () => Promise.resolve({ default: 3 }) }),
    );
    expect(error.code).toBe('MFEFLOW_E603');
  });

  it('wraps a migration that throws', async () => {
    const [project, upgrade] = withMigrations('0.2.0', '0.1.0');
    const error = await rejection(
      planUpgrade(project, {
        ...upgrade,
        importModule: () =>
          Promise.resolve({
            migrate: () => {
              throw new Error('boom');
            },
          }),
      }),
    );
    expect(error.code).toBe('MFEFLOW_E603');
    expect(error.message).toContain('boom');
  });

  it('never runs a migration from a feature that is not first-party', async () => {
    calls.length = 0;
    const [project, upgrade] = withMigrations('0.3.0', '0.1.0');
    const [core] = upgrade.features;
    if (core === undefined) throw new Error('no core');
    const third = { ...core, trust: 'third-party' as const };
    await planUpgrade(project, { ...upgrade, features: [third] }).catch(() => undefined);
    expect(calls).toEqual([]);
  });

  it('refuses a feature without a folder to load the module from', async () => {
    const [project, upgrade] = withMigrations('0.2.0', '0.1.0');
    const [core] = upgrade.features;
    if (core === undefined) throw new Error('no core');
    const { dir: _dir, ...noDir } = core;
    const error = await rejection(planUpgrade(project, { ...upgrade, features: [noDir] }));
    expect(error.code).toBe('MFEFLOW_E603');
  });

  it('loads a real .mjs file from the feature folder when no importer is given', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-migration-'));
    dirs.push(dir);
    await fs.writeFile(
      path.join(dir, 'm.mjs'),
      "export default async function (builder) { await builder.create('from-module.txt', 'hi'); }\n",
    );
    const core = newCore({ migrations: [{ from: '0.1.0', to: '0.2.0', module: 'm.mjs' }] }, dir);
    const up = await planUpgrade(projectOf(OLD), { ...input(OLD), features: [core] });
    expect(up.plan.changes.find((c) => c.path === 'from-module.txt')?.after).toBe('hi');
  });
});

async function tempProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-upgrade-core-'));
  dirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, ...file.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await fs.writeFile(path.join(root, 'mfeflow.json'), '{}\n');
  return root;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(root, full)] = await fs.readFile(full, 'utf8');
    }
  };
  await walk(root);
  return out;
}
