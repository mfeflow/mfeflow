import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseProject } from '@mfeflow/core';
import { main } from '.';
import { REPO, removeDir, tempDir, testRuntime } from './testing';

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

const add = (feature: string) =>
  main(['add', feature, '--no-install', '--cwd', project], testRuntime());
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');

/** The environment without anything the VCS sets, so a child process cannot reach a real repository. */
const cleanEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('GIT_'),
    ),
  ),
  ...extra,
});

describe('the deploy workflow script', () => {
  async function script(): Promise<{ run: string; job: { if?: string } }> {
    expect(await add('ci-github')).toBe(0);
    expect(await add('registry-static')).toBe(0);
    const doc = parse(await read('.github/workflows/deploy.yml')) as {
      jobs: Record<string, { if?: string; steps: { name?: string; run?: string }[] }>;
    };
    const job = Object.values(doc.jobs)[0];
    const run = job?.steps.find((s) => s.name === 'Deploy remotes')?.run;
    expect(run).toBeDefined();
    return { run: run ?? '', job: job ?? {} };
  }

  /** Runs the step in a temp dir with a fake `pnpm` that fails for the remotes in `failing`. */
  async function runStep(run: string, failing: string[]) {
    const dir = await tempDir();
    try {
      await fs.writeFile(
        path.join(dir, 'mfeflow.json'),
        JSON.stringify({
          apps: {
            shell: { kind: 'shell' },
            a: { kind: 'remote' },
            b: { kind: 'remote' },
            c: { kind: 'remote' },
          },
        }),
      );
      const bin = path.join(dir, 'bin');
      await fs.mkdir(bin);
      const fake = path.join(bin, 'pnpm');
      await fs.writeFile(
        fake,
        `#!/bin/sh\necho "$3" >> "${path.join(dir, 'calls')}"\ncase " ${failing.join(' ')} " in *" $3 "*) exit 1;; esac\n`,
      );
      await fs.chmod(fake, 0o755);
      const out = spawnSync('bash', ['-c', run], {
        cwd: dir,
        env: cleanEnv({
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          DEPLOY_ENV: 'prod',
        }),
        encoding: 'utf8',
      });
      const calls = (await fs.readFile(path.join(dir, 'calls'), 'utf8')).trim().split('\n');
      return { status: out.status, text: out.stdout + out.stderr, calls };
    } finally {
      await removeDir(dir);
    }
  }

  it('only runs from main', async () => {
    expect((await script()).job.if).toBe("github.ref == 'refs/heads/main'");
  });

  it('keeps deploying after one remote fails, then fails the run and names it', async () => {
    const { run } = await script();
    const result = await runStep(run, ['b']);
    expect(result.calls).toEqual(['a', 'b', 'c']);
    expect(result.status).toBe(1);
    expect(result.text).toContain('deploy failed for: b');
  });

  it('succeeds when every remote deploys', async () => {
    const { run } = await script();
    const result = await runStep(run, []);
    expect(result.calls).toEqual(['a', 'b', 'c']);
    expect(result.status).toBe(0);
  });
});

describe('release with the real changeset version', () => {
  it('bumps a remote, and deploy publishes the bumped version (slow: runs changesets)', async () => {
    expect(await add('release')).toBe(0);
    const { scope } = parseProject(await read('mfeflow.json'));
    await fs.writeFile(
      path.join(project, '.changeset/cart-minor.md'),
      `---\n'${scope}/cart': minor\n---\n\nCart shows the total.\n`,
    );
    const bin = path.join(REPO, 'node_modules/@changesets/cli/bin.js');
    const out = spawnSync(process.execPath, [bin, 'version'], {
      cwd: project,
      env: cleanEnv(),
      encoding: 'utf8',
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const pkg = JSON.parse(await read('apps/cart/package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');

    const dist = path.join(project, 'apps/cart/dist');
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(
      path.join(dist, 'mf-manifest.json'),
      JSON.stringify({
        name: 'cart',
        metaData: {
          name: 'cart',
          publicPath: 'auto',
          remoteEntry: { name: 'remoteEntry.js', path: '' },
        },
        exposes: [],
      }),
    );
    await fs.writeFile(path.join(dist, 'remoteEntry.js'), 'x');
    const rt = testRuntime();
    const argv = [
      'deploy',
      'cart',
      '--env',
      'prod',
      '--host',
      `file:${path.join(cwd, 'site')}`,
      '--base-url',
      'https://cdn.test',
      '--dry-run',
      '--json',
      '--cwd',
      project,
    ];
    const code = await main(argv, rt);
    const text = rt.io.out.join('');
    expect((JSON.parse(text) as { version: string }).version, text).toBe('0.1.0');
    expect(code).toBe(0);
  }, 60_000);
});
