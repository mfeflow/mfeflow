import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@mfeflow/core';
import { main, type InitResult } from '.';
import { loadToolingPackage } from './catalog';
import {
  chooseToolingPackages,
  DEFAULT_TOOLING_PACKAGES,
  TOOLING_PACKAGES,
  type ToolingPackage,
} from './tooling-packages';
import { readPackageJson } from './version';
import {
  readTree,
  removeDir,
  REPO,
  scriptedPrompter,
  tempDir,
  testRuntime,
  type TestRuntime,
} from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function workspace(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  return cwd;
}

async function run(cwd: string, argv: string[], rt: TestRuntime = testRuntime()) {
  const code = await main([...argv, '--cwd', cwd], rt);
  return { code, out: rt.io.out.join('\n'), err: rt.io.err.join('\n'), rt };
}

function tooling(cwd: string, ...flags: string[]) {
  return run(cwd, [
    'init',
    'tools',
    '--kind',
    'tooling',
    '--scope',
    '@acme',
    '--yes',
    '--no-install',
    ...flags,
  ]);
}

interface PackageFile {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
  publishConfig?: { access?: string };
}

function parsed(text: string | undefined): PackageFile {
  return JSON.parse(text ?? '{}') as PackageFile;
}

const fake: readonly ToolingPackage[] = [
  { name: 'alpha' },
  { name: 'beta', needs: ['alpha'] },
  { name: 'gamma', needs: ['beta'], note: 'only for teams with a shell' },
  { name: 'delta', needs: ['missing'] },
];

describe('chooseToolingPackages', () => {
  it('keeps the catalogue order and drops repeats', () => {
    expect(chooseToolingPackages(['oxlint-config', 'tsconfig', 'tsconfig'])).toEqual({
      packages: ['tsconfig', 'oxlint-config'],
      notices: [],
    });
  });

  it('lists the valid names for an unknown one (E107)', () => {
    expect(() => chooseToolingPackages(['tsconfig', 'nope'])).toThrow(
      /--packages nope.*use tsconfig, oxlint-config/s,
    );
  });

  it('adds what a package needs, through the packages it adds, and says so', () => {
    expect(chooseToolingPackages(['gamma'], fake)).toEqual({
      packages: ['alpha', 'beta', 'gamma'],
      notices: [
        'packages: also made beta, which gamma needs',
        'packages: also made alpha, which beta needs',
        'packages: gamma: only for teams with a shell',
      ],
    });
  });

  it('does not report a package the user already asked for', () => {
    expect(chooseToolingPackages(['alpha', 'beta'], fake).notices).toEqual([]);
  });

  it('refuses a need that is not in the catalogue', () => {
    expect(() => chooseToolingPackages(['delta'], fake)).toThrow(/needs missing/);
  });

  it('has a template folder for every package in the catalogue', async () => {
    const rt = testRuntime();
    for (const entry of TOOLING_PACKAGES) {
      const feature = await loadToolingPackage(entry.name, rt.roots);
      expect(feature.manifest.name).toBe(`tooling-${entry.name}`);
    }
  });
});

describe('init --kind tooling --packages', () => {
  it('makes tsconfig and oxlint-config when the flag is left out', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd);
    expect(err).toBe('');
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(DEFAULT_TOOLING_PACKAGES).toEqual(['tsconfig', 'oxlint-config']);
    expect(
      Object.keys(tree)
        .filter((f) => f.startsWith('packages/tsconfig/'))
        .toSorted(),
    ).toEqual([
      'packages/tsconfig/README.md',
      'packages/tsconfig/base.json',
      'packages/tsconfig/node.json',
      'packages/tsconfig/package.json',
      'packages/tsconfig/react-app.json',
      'packages/tsconfig/react-library.json',
    ]);
    expect(
      Object.keys(tree)
        .filter((f) => f.startsWith('packages/oxlint-config/'))
        .toSorted(),
    ).toEqual([
      'packages/oxlint-config/README.md',
      'packages/oxlint-config/build.mjs',
      'packages/oxlint-config/overrides.json',
      'packages/oxlint-config/package.json',
    ]);
  });

  it('makes one package alone', async () => {
    const cwd = await workspace();
    await tooling(cwd, '--packages', 'tsconfig');
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(tree).toHaveProperty(['packages/tsconfig/base.json']);
    expect(Object.keys(tree).some((f) => f.startsWith('packages/oxlint-config/'))).toBe(false);

    const other = await workspace();
    await tooling(other, '--packages', 'oxlint-config');
    const tree2 = await readTree(path.join(other, 'tools'));
    expect(tree2).toHaveProperty(['packages/oxlint-config/package.json']);
    expect(Object.keys(tree2).some((f) => f.startsWith('packages/tsconfig/'))).toBe(false);
  });

  it.each(['none', ''])('makes no package for --packages "%s"', async (value) => {
    const cwd = await workspace();
    const { code } = await tooling(cwd, '--packages', value);
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(Object.keys(tree).some((f) => /^packages\/(tsconfig|oxlint-config)\//.test(f))).toBe(
      false,
    );
  });

  it('refuses none mixed with names', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--packages', 'none,tsconfig');
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
  });

  it('names the wrapper in the user scope, at version 0.0.0, public, with our package at the CLI version', async () => {
    const cwd = await workspace();
    await tooling(cwd);
    const tree = await readTree(path.join(cwd, 'tools'));
    const version = readPackageJson().version;
    const ts = parsed(tree['packages/tsconfig/package.json']);
    expect(ts).toMatchObject({
      name: '@acme/tsconfig',
      version: '0.0.0',
      publishConfig: { access: 'public' },
      dependencies: { '@mfeflow/tsconfig': `^${version}` },
    });
    expect(Object.keys(ts.exports ?? {})).toEqual([
      './base.json',
      './react-app.json',
      './react-library.json',
      './node.json',
    ]);
    const ox = parsed(tree['packages/oxlint-config/package.json']);
    expect(ox).toMatchObject({
      name: '@acme/oxlint-config',
      version: '0.0.0',
      publishConfig: { access: 'public' },
      devDependencies: { '@mfeflow/oxlint-config': `^${version}` },
      exports: { './oxlintrc.json': './dist/oxlintrc.json' },
    });
    expect(ox.dependencies).toBeUndefined();
  });

  it('has each preset extend ours', async () => {
    const cwd = await workspace();
    await tooling(cwd);
    const tree = await readTree(path.join(cwd, 'tools'));
    for (const name of ['base', 'react-app', 'react-library', 'node']) {
      expect(JSON.parse(tree[`packages/tsconfig/${name}.json`] ?? '{}')).toMatchObject({
        extends: `@mfeflow/tsconfig/${name}.json`,
      });
    }
    expect(tree['packages/tsconfig/README.md']).toContain(
      '"extends": "@acme/tsconfig/react-app.json"',
    );
    expect(tree['packages/oxlint-config/README.md']).toContain(
      './node_modules/@acme/oxlint-config/dist/oxlintrc.json',
    );
  });

  it('links our packages with --local', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--local', REPO);
    expect(err).toBe('');
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(
      parsed(tree['packages/tsconfig/package.json']).dependencies?.['@mfeflow/tsconfig'],
    ).toMatch(/^link:.*packages\/tsconfig$/);
    expect(
      parsed(tree['packages/oxlint-config/package.json']).devDependencies?.[
        '@mfeflow/oxlint-config'
      ],
    ).toMatch(/^link:.*packages\/oxlint-config$/);
  });

  it('records no package in mfeflow.json except the files it wrote', async () => {
    const cwd = await workspace();
    await tooling(cwd);
    const tree = await readTree(path.join(cwd, 'tools'));
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(Object.keys(project.features)).toEqual(['core', 'polyrepo', 'lint-oxlint', 'git-hooks']);
    expect(project.files).toHaveProperty(['packages/tsconfig/base.json']);
    expect(project.files).toHaveProperty(['packages/oxlint-config/build.mjs']);
  });

  it('lists the new files in --json and in --dry-run, and writes nothing for --dry-run', async () => {
    const cwd = await workspace();
    const { code, out } = await tooling(cwd, '--json', '--dry-run');
    expect(code).toBe(0);
    const result = JSON.parse(out) as InitResult;
    const paths = result.plan.changes.map((c) => c.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'packages/tsconfig/package.json',
        'packages/tsconfig/react-app.json',
        'packages/oxlint-config/build.mjs',
        'packages/oxlint-config/overrides.json',
      ]),
    );
    expect(result.plan.features.some((f) => f.name.startsWith('tooling-'))).toBe(false);
    expect(await fs.readdir(cwd)).toEqual([]);

    const text = await tooling(await workspace(), '--dry-run');
    expect(text.out).toContain('packages/tsconfig/react-library.json');
  });

  it('asks for the packages in a prompt', async () => {
    const cwd = await workspace();
    const prompter = scriptedPrompter(['tools', '@acme', ['lint-oxlint'], ['tsconfig']]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const code = await main(['init', '--kind', 'tooling', '--no-install', '--cwd', cwd], rt);
    expect(code).toBe(0);
    expect(prompter.asked).toEqual([
      'Where should the project go?',
      'npm scope for your packages',
      'Features',
      'Packages to make in your scope',
    ]);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(tree).toHaveProperty(['packages/tsconfig/base.json']);
    expect(Object.keys(tree).some((f) => f.startsWith('packages/oxlint-config/'))).toBe(false);
  });

  it('takes the packages from a preset, and the flag wins', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ kind: 'tooling', packages: ['oxlint-config'] }));
    const first = await run(cwd, [
      'init',
      'a',
      '--preset',
      preset,
      '--scope',
      '@acme',
      '--yes',
      '--no-install',
    ]);
    expect(first.code).toBe(0);
    const a = await readTree(path.join(cwd, 'a'));
    expect(a).toHaveProperty(['packages/oxlint-config/package.json']);
    expect(a).not.toHaveProperty(['packages/tsconfig/package.json']);

    const second = await run(cwd, [
      'init',
      'b',
      '--preset',
      preset,
      '--packages',
      'tsconfig',
      '--scope',
      '@acme',
      '--yes',
      '--no-install',
    ]);
    expect(second.code).toBe(0);
    const b = await readTree(path.join(cwd, 'b'));
    expect(b).toHaveProperty(['packages/tsconfig/package.json']);
    expect(b).not.toHaveProperty(['packages/oxlint-config/package.json']);
  });

  it('refuses an unknown package and writes nothing', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--packages', 'tsconfig,analytics');
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
    expect(err).toContain('analytics');
    expect(err).toContain('tsconfig, oxlint-config');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('refuses --packages without --kind tooling, and a preset that has packages for an app repo', async () => {
    const cwd = await workspace();
    const flag = await run(cwd, ['init', 'x', '--packages', 'tsconfig', '--yes', '--no-install']);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain('MFEFLOW_E107');
    expect(flag.err).toContain('--packages is for --kind tooling');

    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ packages: ['tsconfig'] }));
    const viaPreset = await run(cwd, ['init', 'y', '--preset', preset, '--yes', '--no-install']);
    expect(viaPreset.code).toBe(2);
    expect(await fs.readdir(cwd)).toEqual(['preset.json']);
  });
});

describe('the generated packages', () => {
  it('typecheck an app folder that extends @scope/tsconfig through a link', async () => {
    const cwd = await workspace();
    expect((await tooling(cwd, '--packages', 'tsconfig')).code).toBe(0);
    const repo = path.join(cwd, 'tools');
    const app = path.join(cwd, 'app');
    await fs.mkdir(path.join(app, 'src'), { recursive: true });
    await fs.mkdir(path.join(app, 'node_modules', '@acme'), { recursive: true });
    await fs.mkdir(path.join(repo, 'packages', 'tsconfig', 'node_modules', '@mfeflow'), {
      recursive: true,
    });
    await fs.symlink(
      path.join(REPO, 'packages', 'tsconfig'),
      path.join(repo, 'packages', 'tsconfig', 'node_modules', '@mfeflow', 'tsconfig'),
      'junction',
    );
    await fs.symlink(
      path.join(repo, 'packages', 'tsconfig'),
      path.join(app, 'node_modules', '@acme', 'tsconfig'),
      'junction',
    );
    await fs.writeFile(
      path.join(app, 'tsconfig.json'),
      JSON.stringify({ extends: '@acme/tsconfig/react-app.json', include: ['src'] }),
    );
    const tsc = path.join(
      path.dirname(
        createRequire(path.join(REPO, 'package.json')).resolve('typescript/package.json'),
      ),
      'bin',
      'tsc',
    );
    const check = () =>
      spawnSync(process.execPath, [tsc, '-p', app, '--noEmit', '--pretty', 'false'], {
        encoding: 'utf8',
      });

    await fs.writeFile(
      path.join(app, 'src', 'a.ts'),
      'export const first = (xs: string[]): string | undefined => xs[0];\n',
    );
    expect(check().status, check().stdout).toBe(0);

    await fs.writeFile(
      path.join(app, 'src', 'a.ts'),
      'export const first = (xs: string[]): string => xs[0];\n',
    );
    const failed = check();
    expect(failed.status).not.toBe(0);
    expect(failed.stdout).toContain('TS2322');
    expect(failed.stdout).toContain('undefined');
  }, 120_000);

  it('builds an oxlintrc.json from ours with the overrides on top', async () => {
    const cwd = await workspace();
    await tooling(cwd, '--packages', 'oxlint-config');
    const dir = path.join(cwd, 'tools', 'packages', 'oxlint-config');
    const ours = path.join(dir, 'node_modules', '@mfeflow', 'oxlint-config');
    await fs.mkdir(ours, { recursive: true });
    await fs.writeFile(
      path.join(ours, 'package.json'),
      JSON.stringify({
        name: '@mfeflow/oxlint-config',
        exports: { './oxlintrc.json': './oxlintrc.json' },
      }),
    );
    await fs.writeFile(
      path.join(ours, 'oxlintrc.json'),
      JSON.stringify({
        plugins: ['typescript', 'react'],
        rules: { 'no-debugger': 'error', 'no-console': 'warn' },
        ignorePatterns: ['**/dist/**'],
        options: { typeAware: true },
      }),
    );
    await fs.writeFile(
      path.join(dir, 'overrides.json'),
      JSON.stringify({
        plugins: ['react', 'import'],
        rules: { 'no-console': 'error' },
        ignorePatterns: ['**/generated/**'],
        categories: { perf: 'error' },
      }),
    );
    const built = spawnSync(process.execPath, [path.join(dir, 'build.mjs')], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(built.status, built.stderr).toBe(0);
    const result = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'oxlintrc.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(result).toEqual({
      plugins: ['typescript', 'react', 'import'],
      rules: { 'no-debugger': 'error', 'no-console': 'error' },
      ignorePatterns: ['**/dist/**', '**/generated/**'],
      options: { typeAware: true },
      categories: { perf: 'error' },
    });

    await fs.writeFile(path.join(dir, 'overrides.json'), '{}');
    expect(spawnSync(process.execPath, [path.join(dir, 'build.mjs')], { cwd: dir }).status).toBe(0);
    const plain = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'oxlintrc.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(plain.rules).toEqual({ 'no-debugger': 'error', 'no-console': 'warn' });
  });
});
