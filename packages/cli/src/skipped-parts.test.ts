import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, validateResult, type AddResult } from '.';
import { readTree, removeDir, tempDir, testRuntime } from './testing';

let cwd: string;
let remoteOnly: string;
let withShell: string;

async function run(dir: string, argv: string[]): Promise<{ code: number; out: string }> {
  const rt = testRuntime();
  const code = await main([...argv, '--cwd', dir], rt);
  return { code, out: rt.io.out.join('\n') };
}

async function dryRun(dir: string, ...features: string[]): Promise<AddResult> {
  const { code, out } = await run(dir, [
    'add',
    ...features,
    '--yes',
    '--no-install',
    '--json',
    '--dry-run',
  ]);
  expect(code).toBe(0);
  const result = JSON.parse(out) as AddResult;
  expect(validateResult(result)).toEqual([]);
  return result;
}

beforeAll(async () => {
  cwd = await tempDir();
  const init = ['init', 'demo', '--remotes', 'catalog,cart', '--yes', '--no-install'];
  for (const name of ['demo', 'shelled']) {
    const { code } = await run(cwd, ['init', name, ...init.slice(2)]);
    expect(code).toBe(0);
  }
  withShell = path.join(cwd, 'shelled');
  remoteOnly = path.join(cwd, 'demo');
  await fs.rm(path.join(remoteOnly, 'apps', 'shell'), { recursive: true });
  const file = path.join(remoteOnly, 'mfeflow.json');
  const project = JSON.parse(await fs.readFile(file, 'utf8')) as {
    apps: Record<string, unknown>;
    files?: Record<string, string>;
    repo?: string;
  };
  delete project.apps.shell;
  project.repo = 'remote';
  for (const name of Object.keys(project.files ?? {})) {
    if (name.startsWith('apps/shell/')) delete project.files?.[name];
  }
  await fs.writeFile(file, `${JSON.stringify(project, null, 2)}\n`);
});

afterAll(async () => {
  await removeDir(cwd);
});

describe('a feature added to a repo with remotes and no shell', () => {
  it.each(['theming', 'telemetry-otel', 'analytics-gtm', 'tailwind'])(
    'reports the shell parts of %s',
    async (feature) => {
      const { plan } = await dryRun(remoteOnly, feature);
      expect(plan.skipped.length).toBeGreaterThan(0);
      for (const part of plan.skipped) {
        expect(part).toMatchObject({ feature, target: 'shell' });
        expect(['file', 'dependency', 'script', 'transform']).toContain(part.kind);
      }
      expect(plan.changes.some((c) => c.path.startsWith('apps/shell/'))).toBe(false);
    },
  );

  it('writes the same files it wrote before the report existed', async () => {
    const { plan } = await dryRun(remoteOnly, 'theming');
    expect(plan.changes.map((c) => c.path)).toEqual([
      'apps/cart/package.json',
      'apps/cart/src/theme/tokens.test.ts',
      'apps/cart/src/theme/tokens.ts',
      'apps/catalog/package.json',
      'apps/catalog/src/theme/tokens.test.ts',
      'apps/catalog/src/theme/tokens.ts',
      'mfeflow.json',
    ]);
    expect(plan.skipped.map((p) => `${p.kind} ${p.name}`)).toContain('dependency @mfeflow/theme');
  });

  it('prints one block per feature in the text output', async () => {
    const { out } = await run(remoteOnly, [
      'add',
      'theming',
      'tailwind',
      '--yes',
      '--no-install',
      '--dry-run',
    ]);
    const blocks = out
      .split('\n')
      .filter((l) => l.startsWith('Skipped because this repo has no shell'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('Add `theming` in the shell repo too.');
    expect(blocks[1]).toContain('Add `tailwind` in the shell repo too.');
  });

  it('keeps the folder as it was on a dry run', async () => {
    const before = Object.keys(await readTree(remoteOnly));
    await dryRun(remoteOnly, 'telemetry-otel');
    expect(Object.keys(await readTree(remoteOnly))).toEqual(before);
  });

  it.each(['forms', 'lint-oxlint'])(
    'reports nothing for %s, which has no shell part',
    async (feature) => {
      const { plan } = await dryRun(remoteOnly, feature);
      expect(plan.skipped).toEqual([]);
    },
  );
});

describe('a feature added to a project with a shell', () => {
  it.each(['theming', 'telemetry-otel', 'analytics-gtm', 'tailwind'])(
    'reports nothing for %s',
    async (feature) => {
      const { plan } = await dryRun(withShell, feature);
      expect(plan.skipped).toEqual([]);
    },
  );

  it('prints no skipped block', async () => {
    const { out } = await run(withShell, ['add', 'theming', '--yes', '--no-install', '--dry-run']);
    expect(out).not.toContain('Skipped because');
  });
});
