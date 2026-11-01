import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseProject } from '@mfeflow/core';
import { main } from '.';
import { REPO, readTree, removeDir, tempDir, testRuntime } from './testing';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(
    ['init', 'app', '--yes', '--no-install', '--features=lint-oxlint,url-factory', '--cwd', cwd],
    testRuntime(),
  );
  expect(code).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const add = (...args: string[]) =>
  main(['add', ...args, '--no-install', '--cwd', project], testRuntime());
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');
const json = async (file: string) =>
  JSON.parse(await read(file)) as Record<string, Record<string, string>>;

describe('registry-static', () => {
  const addIt = (...options: string[]) =>
    add('registry-static', ...options.flatMap((o) => ['--option', `registry-static.${o}`]));

  it('writes the guide with the configured host, three scripts, and no workflow without ci-github', async () => {
    expect(await addIt('host=s3://my-registry', 'baseUrl=https://cdn.example.com')).toBe(0);
    const guide = await read('docs/registry.md');
    expect(guide).toContain('`s3://my-registry`');
    expect(guide).toContain('`https://cdn.example.com`');
    const pkg = await json('package.json');
    expect(pkg.scripts).toMatchObject({
      'registry:deploy': 'mfeflow deploy',
      'registry:rollback': 'mfeflow rollback',
      'registry:status': 'mfeflow status',
    });
    expect(pkg.devDependencies).toHaveProperty(['mfeflow']);
    expect(await readTree(project)).not.toHaveProperty(['.github/workflows/deploy.yml']);
  });

  it('says so in the guide when the options are left empty', async () => {
    expect(await addIt()).toBe(0);
    expect(await read('docs/registry.md')).toContain('not set yet');
    expect(parseProject(await read('mfeflow.json')).features['registry-static']?.options).toEqual({
      host: '',
      baseUrl: '',
    });
  });

  describe('with ci-github', () => {
    interface Step {
      uses?: string;
      run?: string;
      env?: Record<string, string>;
    }
    interface Workflow {
      on: Record<string, unknown>;
      permissions: unknown;
      concurrency: { 'cancel-in-progress': boolean };
      jobs: Record<string, { permissions: unknown; steps: Step[] }>;
    }

    async function deploy(): Promise<{ text: string; steps: Step[]; doc: Workflow }> {
      expect(await add('ci-github')).toBe(0);
      expect(await addIt('host=s3://my-registry')).toBe(0);
      const text = await read('.github/workflows/deploy.yml');
      const doc = parse(text) as Workflow;
      return { text, doc, steps: Object.values(doc.jobs)[0]?.steps ?? [] };
    }

    it('deploys on main, never on a pull request, with read-only token permissions', async () => {
      const { doc } = await deploy();
      expect(Object.keys(doc.on).toSorted()).toEqual(['push', 'workflow_dispatch']);
      expect(doc.permissions).toEqual({});
      expect(Object.values(doc.jobs).map((job) => job.permissions)).toEqual([{ contents: 'read' }]);
      expect(doc.concurrency['cancel-in-progress']).toBe(false);
    });

    it('pins every action to a commit SHA and takes credentials from secrets only', async () => {
      const { steps, text } = await deploy();
      for (const uses of steps.flatMap((s) => (s.uses ? [s.uses] : [])))
        expect(uses).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
      const env = steps.find((s) => s.env?.AWS_ACCESS_KEY_ID)?.env ?? {};
      expect(env).toMatchObject({
        AWS_ACCESS_KEY_ID: '${{ secrets.AWS_ACCESS_KEY_ID }}',
        AWS_SECRET_ACCESS_KEY: '${{ secrets.AWS_SECRET_ACCESS_KEY }}',
      });
      // No expression is pasted into a script, and no key is written in the file.
      for (const run of steps.flatMap((s) => (s.run ? [s.run] : [])))
        expect(run).not.toContain('${{');
      expect(text).not.toMatch(/AKIA[0-9A-Z]{8,}/);
    });

    it('reads the remotes from mfeflow.json at run time, so one added later is deployed too', async () => {
      const { steps } = await deploy();
      const run = steps.find((s) => s.run?.includes('mfeflow deploy'))?.run;
      expect(run).toContain('mfeflow.json');
      expect(run).toContain('pnpm mfeflow deploy "$remote" --env "$DEPLOY_ENV" --yes');
    });
  });
});

describe('both features together', () => {
  it('generate files that pass prettier --check', async () => {
    for (const feature of ['ci-github', 'registry-static', 'release'])
      expect(await add(feature)).toBe(0);
    const prettier = path.join(REPO, 'node_modules/prettier/bin/prettier.cjs');
    expect(() => {
      execFileSync(process.execPath, [prettier, '--check', '.'], { cwd: project, stdio: 'pipe' });
    }).not.toThrow();
  }, 30_000);
});

describe('release', () => {
  it('configures Changesets for private remotes and adds the scripts', async () => {
    expect(await add('release')).toBe(0);
    const config = JSON.parse(await read('.changeset/config.json')) as Record<string, unknown>;
    expect(config).toMatchObject({
      baseBranch: 'main',
      access: 'restricted',
      privatePackages: { version: true, tag: false },
    });
    const pkg = await json('package.json');
    expect(pkg.scripts).toMatchObject({
      changeset: 'changeset',
      'release:version': 'changeset version',
    });
    expect(pkg.devDependencies).toHaveProperty(['@changesets/cli']);
    expect(await read('docs/releasing.md')).toContain('mfeflow deploy');
  });

  it('works on remotes that start as private packages with a version, the file deploy reads', async () => {
    expect(await add('release')).toBe(0);
    const remote = JSON.parse(await read('apps/cart/package.json')) as {
      version: string;
      private: boolean;
    };
    expect(remote.private).toBe(true);
    expect(remote.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
