import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMfeflowProject } from '@mfeflow/contracts';
import { MfeflowError, parseProject } from '@mfeflow/core';
import { main, validateResult, type InitResult } from '.';
import { FIRST_PARTY, loadAny } from './catalog';
import { appPartOf, assertToolingFeatures } from './polyrepo';
import {
  readTree,
  removeDir,
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

interface Run {
  code: number;
  out: string;
  err: string;
  rt: TestRuntime;
}

async function run(cwd: string, argv: string[], rt: TestRuntime = testRuntime()): Promise<Run> {
  const code = await main([...argv, '--cwd', cwd], rt);
  return { code, out: rt.io.out.join('\n'), err: rt.io.err.join('\n'), rt };
}

async function tooling(cwd: string, ...flags: string[]): Promise<Run> {
  return run(cwd, ['init', 'tools', '--kind', 'tooling', '--yes', '--no-install', ...flags]);
}

async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

describe('init --kind', () => {
  it('refuses an unknown --kind with E107', async () => {
    const cwd = await workspace();
    const { code, err } = await run(cwd, [
      'init',
      'x',
      '--kind',
      'library',
      '--yes',
      '--no-install',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
    expect(err).toMatch(/use app, remote or tooling/);
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('keeps making an app repo for --kind app and for no --kind', async () => {
    const cwd = await workspace();
    const { code } = await run(cwd, [
      'init',
      'a',
      '--kind',
      'app',
      '--yes',
      '--no-install',
      '--remotes',
      'cart',
    ]);
    expect(code).toBe(0);
    const project = parseProject(await fs.readFile(path.join(cwd, 'a', 'mfeflow.json'), 'utf8'));
    expect(Object.keys(project.apps)).toEqual(['shell', 'cart']);
    expect(project.repo).toBeUndefined();
  });

  it('reads the kind from a preset', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ kind: 'tooling', scope: '@acme' }));
    const { code } = await run(cwd, ['init', 't', '--preset', preset, '--yes', '--no-install']);
    expect(code).toBe(0);
    const project = parseProject(await fs.readFile(path.join(cwd, 't', 'mfeflow.json'), 'utf8'));
    expect(project.repo).toBe('platform');
    expect(project.scope).toBe('@acme');
  });

  it.each([
    [['--topology', 'polyrepo'], /one repo/],
    [['--remotes', 'cart'], /no apps/],
    [['--remotes', ''], /no apps/],
  ])('refuses %j next to --kind tooling', async (flags, message) => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, ...flags);
    expect(code).toBe(2);
    expect(err).toMatch(message);
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('still refuses --org outside polyrepo and tooling', async () => {
    const cwd = await workspace();
    const { err } = await run(cwd, ['init', 'a', '--org', 'acme', '--yes', '--no-install']);
    expect(err).toContain('--org is for --topology polyrepo or --kind tooling');
  });
});

describe('init --kind tooling', () => {
  it('makes a platform repo with no apps and a monorepo topology', async () => {
    const cwd = await workspace();
    const { code, err, out, rt } = await tooling(cwd, '--scope', '@acme');
    expect(err).toBe('');
    expect(code).toBe(0);
    const root = path.join(cwd, 'tools');
    const file = await json(path.join(root, 'mfeflow.json'));
    expect(validateMfeflowProject(file)).toEqual([]);
    expect(file).toMatchObject({
      repo: 'platform',
      topology: 'monorepo',
      scope: '@acme',
      apps: {},
    });
    expect(Object.keys(file.features as object)).toEqual([
      'core',
      'polyrepo',
      'lint-oxlint',
      'git-hooks',
    ]);
    const files = Object.keys(await readTree(root));
    expect(files).toEqual(
      expect.arrayContaining([
        'package.json',
        'pnpm-workspace.yaml',
        'tsconfig.base.json',
        'renovate.json',
        'default.json',
        '.changeset/config.json',
        '.github/workflows/ci.yml',
        'packages/contracts/src/index.ts',
        'packages/tokens/src/index.ts',
        '.oxlintrc.json',
        'lefthook.yml',
      ]),
    );
    expect(files.some((f) => f.startsWith('apps/') || f.startsWith('registry/'))).toBe(false);
    expect(files).not.toContain('turbo.json');
    expect(rt.system.repoInits).toEqual([root]);
    expect(out).toContain('a repo for shared tooling with no apps');
    expect(out).not.toContain('tools/\n');
  });

  it('names the repo in its own text and in the Renovate preset', async () => {
    const cwd = await workspace();
    await tooling(cwd, '--org', 'acme-co');
    const root = path.join(cwd, 'tools');
    const tree = await readTree(root);
    expect(tree['AGENTS.md']).toContain('This is a tooling repo');
    expect(tree['AGENTS.md']).not.toContain('polyrepo');
    expect(tree['README.md']).toContain('A repo for shared tooling');
    expect(tree['README.md']).not.toContain('polyrepo');
    expect(tree['renovate.json']).toContain('github>acme-co/tools');
    expect(tree['default.json']).toContain('github>acme-co/tools');
    expect(tree['.github/workflows/reusable-ci.yml']).toContain('acme-co/tools/.github');
  });

  it('starts with lint-oxlint and git-hooks, and offers only the allowed features', async () => {
    const cwd = await workspace();
    const prompter = scriptedPrompter(['tools', '@acme', ['commit-prompt'], []]);
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
    const project = parseProject(
      await fs.readFile(path.join(cwd, 'tools', 'mfeflow.json'), 'utf8'),
    );
    expect(Object.keys(project.features)).toEqual(['core', 'polyrepo', 'commit-prompt']);
  });

  it.each([
    ['lint-oxlint', ['.oxlintrc.json', '.prettierrc.json'], ['lint', 'format:check']],
    ['git-hooks', ['lefthook.yml', 'commitlint.config.js'], ['prepare']],
    ['commit-prompt', ['cz.config.js'], ['commit']],
  ])('applies %s alone', async (feature, files, scripts) => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--features', feature);
    expect(err).toBe('');
    expect(code).toBe(0);
    const root = path.join(cwd, 'tools');
    const tree = await readTree(root);
    for (const f of files) expect(tree).toHaveProperty([f]);
    const pkg = JSON.parse(tree['package.json'] ?? '{}') as { scripts: Record<string, string> };
    for (const s of scripts) expect(pkg.scripts).toHaveProperty([s]);
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(Object.keys(project.features)).toEqual(['core', 'polyrepo', feature]);
  });

  it('accepts release and leaves the platform Changesets as they are, saying so', async () => {
    const cwd = await workspace();
    const { code, out, err } = await tooling(cwd, '--features', 'release');
    expect(err).toBe('');
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(tree['.changeset/config.json']).toContain('"access": "public"');
    expect(tree).not.toHaveProperty(['docs/releasing.md']);
    expect(out).toContain('already versions and publishes its packages with Changesets');
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(Object.keys(project.features)).toEqual(['core', 'polyrepo']);
  });

  it('applies all four together, in catalogue order', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(
      cwd,
      '--features',
      'release,commit-prompt,git-hooks,lint-oxlint',
    );
    expect(err).toBe('');
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(Object.keys(project.features)).toEqual([
      'core',
      'polyrepo',
      'lint-oxlint',
      'git-hooks',
      'commit-prompt',
    ]);
    const pkg = JSON.parse(tree['package.json'] ?? '{}') as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining(['build', 'changeset', 'lint', 'prepare', 'commit']),
    );
  });

  it('takes no features from a preset with an empty list', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ features: [] }));
    const { code } = await tooling(cwd, '--preset', preset);
    expect(code).toBe(0);
    const tree = await readTree(path.join(cwd, 'tools'));
    expect(Object.keys(parseProject(tree['mfeflow.json'] ?? '').features)).toEqual([
      'core',
      'polyrepo',
    ]);
  });

  it.each([
    ['theming', 'theming'],
    ['env-t3', 'env-t3'],
    ['deploy-docker', 'deploy-docker'],
    ['registry-static', 'registry-static'],
    ['lint-oxlint,telemetry-otel', 'telemetry-otel'],
  ])('refuses %s with E216 naming the feature, and writes nothing', async (features, named) => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--features', features);
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E216');
    expect(err).not.toContain('MFEFLOW_E107');
    expect(err).toContain(`--features ${named}: needs an app (`);
    expect(err).toContain('a tooling repo has none');
    expect(err).toContain('shell and remote repos of a polyrepo');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('refuses ci-github and says it would replace the repo CI file', async () => {
    const cwd = await workspace();
    const { code, err } = await tooling(cwd, '--features', 'ci-github');
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
    expect(err).toContain('--features ci-github: not in a tooling repo');
    expect(err).toContain('.github/workflows/ci.yml, which this repo already has');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('refuses a folder that is not empty and removes nothing', async () => {
    const cwd = await workspace();
    await fs.mkdir(path.join(cwd, 'tools'));
    await fs.writeFile(path.join(cwd, 'tools', 'keep.txt'), 'x');
    const { code, err } = await tooling(cwd);
    expect(code).not.toBe(0);
    expect(err).toContain('already has keep.txt');
    expect(await fs.readFile(path.join(cwd, 'tools', 'keep.txt'), 'utf8')).toBe('x');
  });

  it('prints a valid --json result with no apps', async () => {
    const cwd = await workspace();
    const { code, out } = await tooling(cwd, '--json');
    expect(code).toBe(0);
    const result = JSON.parse(out) as InitResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.apps).toEqual([]);
    expect(result.repos).toBeUndefined();
    expect(result.next).toEqual(['cd tools', 'pnpm install', 'pnpm build']);
  });

  it('writes nothing on --dry-run', async () => {
    const cwd = await workspace();
    const { code, out } = await tooling(cwd, '--dry-run');
    expect(code).toBe(0);
    expect(out).toContain('Dry run: nothing was written.');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('runs pnpm install unless told not to', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    const { code } = await run(cwd, ['init', 'tools', '--kind', 'tooling', '--yes'], rt);
    expect(code).toBe(0);
    expect(rt.system.installs.map((i) => i.root)).toEqual([path.join(cwd, 'tools')]);
  });
});

describe('commands in a project with no apps', () => {
  async function toolingRoot(): Promise<string> {
    const cwd = await workspace();
    expect((await tooling(cwd)).code).toBe(0);
    return path.join(cwd, 'tools');
  }

  it.each([
    ['validate', 'the validate checks'],
    ['check-compat', 'the check-compat checks'],
  ])('%s prints one line and exits 0', async (command) => {
    const root = await toolingRoot();
    const { code, out, err } = await run(root, [command]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe('This project has no apps, so the checks about apps have nothing to look at.');
  });

  it('doctor prints the line, then the checks that still apply, and exits 0', async () => {
    const root = await toolingRoot();
    const { code, out } = await run(root, ['doctor']);
    expect(code).toBe(0);
    expect(out.startsWith('This project has no apps, so the checks about apps')).toBe(true);
    expect(out).toContain('copied files match the hashes in mfeflow.json');
  });

  it('dev prints one line and exits 0 without starting anything', async () => {
    const root = await toolingRoot();
    const rt = testRuntime();
    const { code, out, err } = await run(root, ['dev'], rt);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe('This project has no apps, so there is nothing to run.');
    expect(rt.dev?.procs).toEqual([]);
  });

  it('budget prints one line and exits 0', async () => {
    const root = await toolingRoot();
    const { code, out } = await run(root, ['budget']);
    expect(code).toBe(0);
    expect(out).toBe('This project has no apps, so there is no size to measure.');
  });

  it('upgrade --dry-run prints one line, exits 0 and changes nothing', async () => {
    const root = await toolingRoot();
    const before = await readTree(root);
    const { code, out, err } = await run(root, ['upgrade', '--dry-run']);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe(
      'This project has no apps, so there is nothing to upgrade. Update the mfeflow packages in package.json by hand.',
    );
    expect(await readTree(root)).toEqual(before);
  });

  it.each(['validate', 'doctor', 'check-compat', 'budget', 'dev', 'upgrade'])(
    '%s --json is a valid document with empty lists',
    async (command) => {
      const root = await toolingRoot();
      const { code, out } = await run(root, [command, '--json', '--dry-run']);
      expect(code).toBe(0);
      const result: unknown = JSON.parse(out);
      expect(validateResult(result)).toEqual([]);
      expect(result).toMatchObject({ ok: true, command });
    },
  );
});

describe('which features a repo with no apps takes', () => {
  const rt = testRuntime();
  const ALLOWED = ['lint-oxlint', 'git-hooks', 'commit-prompt', 'release'];
  /** Refused because they write to an app, or are about apps. A new feature must be added here or to ALLOWED by a person. */
  const REFUSED = [
    'analytics-clarity',
    'analytics-gtm',
    'ci-github',
    'data-react-query',
    'deploy-cloudflare',
    'deploy-docker',
    'env-t3',
    'event-bus',
    'forms',
    'http',
    'i18n',
    'registry-server',
    'registry-static',
    'route-factory',
    'storybook',
    'tailwind',
    'telemetry-otel',
    'testing',
    'theming',
    'ui-shadcn',
    'url-factory',
  ];
  const names = FIRST_PARTY.filter((f) => !f.always).map((f) => f.name);

  const verdicts = async (): Promise<Record<string, string | undefined>> => {
    const entries = await Promise.all(
      names.map(
        async (name) => [name, appPartOf(await loadAny(name, { roots: rt.roots }))] as const,
      ),
    );
    return Object.fromEntries(entries);
  };

  const refusalOf = async (
    name: string,
  ): Promise<{ code: string; message: string } | undefined> => {
    try {
      await assertToolingFeatures(rt, [name]);
    } catch (error) {
      if (error instanceof MfeflowError) return { code: error.code, message: error.message };
      throw error;
    }
    return undefined;
  };

  it('qualifies a feature when every part targets the root', async () => {
    const taken = Object.entries(await verdicts())
      .filter(([, why]) => why === undefined)
      .map(([name]) => name);
    expect(taken.toSorted()).toEqual([...ALLOWED, 'ci-github'].toSorted());
  });

  it('says which part sends a feature to an app', async () => {
    const all = await verdicts();
    expect(all.theming).toMatch(/goes to (shell|remotes)/);
    expect(all['env-t3']).toMatch(/goes to /);
  });

  it('keeps deploy-docker and registry-static out although they write only at the root', async () => {
    const all = await verdicts();
    expect(all['deploy-docker']).toBe('it builds images of the shell and the remotes');
    expect(all['registry-static']).toBe('it deploys the remotes registry');
  });

  it('has every feature folder listed as allowed or refused, so a new one needs a decision', async () => {
    const dir = path.resolve(import.meta.dirname, '../../../features');
    const folders = (await fs.readdir(dir)).filter((f) => FIRST_PARTY.some((p) => p.name === f));
    const optional = folders.filter((f) => names.includes(f));
    expect(optional.toSorted()).toEqual([...ALLOWED, ...REFUSED].toSorted());
    const unregistered = (await fs.readdir(dir)).filter(
      (f) => !FIRST_PARTY.some((p) => p.name === f),
    );
    expect(unregistered).toEqual([]);
  });

  it('passes the allowed features and refuses every other first-party feature', async () => {
    const results = await Promise.all(
      names.map(async (name) => [name, await refusalOf(name)] as const),
    );
    const passed = results.filter(([, r]) => r === undefined).map(([n]) => n);
    expect(passed.toSorted()).toEqual(ALLOWED.toSorted());
    for (const [name, refusal] of results) {
      if (ALLOWED.includes(name)) continue;
      const expected = name === 'ci-github' ? 'MFEFLOW_E107' : 'MFEFLOW_E216';
      expect(refusal?.code, name).toBe(expected);
      expect(refusal?.message, name).toContain(`--features ${name}:`);
    }
  });
});

describe('polyrepo platform repo', () => {
  async function platformTree(...flags: string[]): Promise<Record<string, string>> {
    const cwd = await workspace();
    const { code, err } = await run(cwd, [
      'init',
      'org',
      '--topology',
      'polyrepo',
      '--yes',
      '--no-install',
      ...flags,
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    return readTree(path.join(cwd, 'org', 'platform'));
  }

  it('is byte for byte the same with features that only apply to apps', async () => {
    const plain = await platformTree();
    expect(await platformTree('--features', 'theming,telemetry-otel')).toEqual(plain);
    expect(await platformTree('--features', 'deploy-docker,registry-static')).toEqual(plain);
    expect(await platformTree('--features', 'release')).toEqual(plain);
  });

  it('keeps the polyrepo text and the platform renovate preset name', async () => {
    const plain = await platformTree();
    expect(plain['AGENTS.md']).toContain('repo of a polyrepo');
    expect(plain['README.md']).toContain('The shared repo of a polyrepo');
    expect(plain['renovate.json']).toContain('github>org/platform');
    const mfeflow = JSON.parse(plain['mfeflow.json'] ?? '{}') as { topology: string };
    expect(mfeflow.topology).toBe('polyrepo');
  });

  it('gets the root-only features that were picked', async () => {
    const plain = await platformTree();
    const picked = await platformTree('--features', 'lint-oxlint,git-hooks,commit-prompt,theming');
    const added = Object.keys(picked).filter((f) => !(f in plain));
    expect(added.toSorted()).toEqual([
      '.oxlintrc.json',
      '.prettierignore',
      '.prettierrc.json',
      'commitlint.config.js',
      'cz.config.js',
      'lefthook.yml',
    ]);
    for (const file of Object.keys(plain)) {
      if (!['mfeflow.json', 'package.json', 'pnpm-workspace.yaml'].includes(file)) {
        expect(picked[file]).toBe(plain[file]);
      }
    }
    expect(JSON.parse(picked['mfeflow.json'] ?? '{}')).toMatchObject({ topology: 'polyrepo' });
  });
});
