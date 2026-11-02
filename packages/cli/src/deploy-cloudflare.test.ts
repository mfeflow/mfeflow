import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { format } from 'prettier';
import { parse } from 'yaml';
import { parseProject, serializeProject } from '@mfeflow/core';
import { main } from '.';
import { readTree, removeDir, tempDir, testRuntime } from './testing';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(
    [
      'init',
      'app',
      '--yes',
      '--no-install',
      '--features=lint-oxlint,url-factory,env-t3',
      '--cwd',
      cwd,
    ],
    testRuntime(),
  );
  expect(code).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const add = (...args: string[]) =>
  main(['add', ...args, '--no-install', '--cwd', project], testRuntime());
/** Forgets that a feature was added, as `add` would if its files were already there. */
async function forget(feature: string): Promise<void> {
  const saved = parseProject(await read('mfeflow.json'));
  const { [feature]: _gone, ...features } = saved.features;
  await fs.writeFile(path.join(project, 'mfeflow.json'), serializeProject({ ...saved, features }));
}
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');

/** Removes // and block comments outside strings, and trailing commas, so JSON.parse can read JSONC. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i = text.indexOf('*/', i) + 1;
    } else out += c;
  }
  return JSON.parse(out.replaceAll(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

const obj = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

interface Rule {
  pattern: string;
  headers: Record<string, string>;
}

function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) rules.push({ pattern: line.trim(), headers: {} });
    else {
      const [name = '', ...value] = line.trim().split(':');
      const last = rules.at(-1);
      if (last === undefined) throw new Error('header before a path');
      last.headers[name.trim()] = value.join(':').trim();
    }
  }
  return rules;
}

const matches = (pattern: string, url: string): boolean =>
  new RegExp(`^${pattern.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`).test(
    url,
  );

/** Every Cache-Control a path would be sent, as Cloudflare joins repeats. */
const cacheControl = (rules: Rule[], url: string): string[] =>
  rules.filter((r) => matches(r.pattern, url)).flatMap((r) => r.headers['Cache-Control'] ?? []);

const NO_CACHE = ['/', '/index.html', '/mf-manifest.json'];
const IMMUTABLE = ['/static/js/index.9da5683424.js', '/static/css/index.068faf688d.css'];

describe('deploy-cloudflare files', () => {
  it('writes a Worker per app with staging and prod, the SPA fallback only on the shell', async () => {
    expect(await add('deploy-cloudflare')).toBe(0);
    const shell = parseJsonc(await read('apps/shell/wrangler.jsonc'));
    expect(shell.name).toBe('app-shell');
    expect(shell.compatibility_date).toBe('2026-11-01');
    expect(obj(shell.assets)).toEqual({
      directory: './dist',
      not_found_handling: 'single-page-application',
    });
    const envs = obj(shell.env);
    expect(Object.keys(envs)).toEqual(['staging', 'prod']);
    expect(obj(envs.prod).name).toBe('app-shell-prod');
    expect(obj(envs.staging).name).toBe('app-shell-staging');
    expect(obj(obj(envs.prod).assets)).toEqual({
      directory: './.mfeflow/cloudflare/prod',
      not_found_handling: 'single-page-application',
    });
    for (const remote of ['catalog', 'cart']) {
      const config = parseJsonc(await read(`apps/${remote}/wrangler.jsonc`));
      expect(config.name).toBe(`app-${remote}`);
      expect(obj(config.assets).not_found_handling).toBe('none');
      expect(obj(obj(config.env).prod).name).toBe(`app-${remote}-prod`);
      expect(JSON.stringify(config)).not.toContain('single-page-application');
    }
    const tree = await readTree(project);
    expect(tree).not.toHaveProperty(['apps/shell/worker/registry-proxy.ts']);
    expect(tree).not.toHaveProperty(['deploy/r2-cors.json']);
    expect(tree).not.toHaveProperty(['.github/workflows/deploy-cloudflare.yml']);
    const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['deploy:cloudflare']).toContain('scripts/deploy-cloudflare.ts');
  });

  it('gives every Worker a different name in each environment', async () => {
    await add('deploy-cloudflare');
    const names: string[] = [];
    for (const app of ['shell', 'catalog', 'cart']) {
      const config = parseJsonc(await read(`apps/${app}/wrangler.jsonc`));
      names.push(String(config.name));
      for (const env of Object.values(obj(config.env))) names.push(String(obj(env).name));
    }
    expect(new Set(names).size).toBe(9);
  });

  it('puts no-cache on the files that decide what is live and immutable on hashed files, one rule each', async () => {
    await add('deploy-cloudflare');
    for (const file of ['apps/shell/public/_headers', 'apps/catalog/public/_headers']) {
      const rules = parseHeaders(await read(file));
      expect(rules.length).toBeLessThanOrEqual(100);
      for (const url of NO_CACHE)
        expect(cacheControl(rules, url), `${file} ${url}`).toEqual(['no-cache']);
      for (const url of IMMUTABLE)
        expect(cacheControl(rules, url), `${file} ${url}`).toEqual([
          'public, max-age=31536000, immutable',
        ]);
    }
    const shell = parseHeaders(await read('apps/shell/public/_headers'));
    expect(cacheControl(shell, '/config/runtime-config.json')).toEqual(['no-cache']);
    expect(cacheControl(shell, '/registry/index.json')).toEqual(['no-cache']);
    expect(cacheControl(shell, '/config/runtime-config.prod.json')).toEqual(['no-cache']);
  });

  it('lets the shell load remotes across origins, and only remotes', async () => {
    await add('deploy-cloudflare');
    const remote = parseHeaders(await read('apps/cart/public/_headers'));
    const cors = remote.filter((r) => matches(r.pattern, '/static/js/a.1.js'));
    expect(cors.some((r) => r.headers['Access-Control-Allow-Origin'] === '__SHELL_ORIGIN__')).toBe(
      true,
    );
    expect(await read('apps/shell/public/_headers')).not.toContain('Access-Control');
  });

  it('formats the way the project does, so its own prettier check passes', async () => {
    await add('deploy-cloudflare');
    const rc = JSON.parse(await read('.prettierrc.json')) as Record<string, unknown>;
    for (const file of [
      'apps/shell/wrangler.jsonc',
      'apps/cart/wrangler.jsonc',
      'deploy/cloudflare.json',
      'scripts/deploy-cloudflare.ts',
      'docs/cloudflare.md',
    ]) {
      const text = await read(file);
      expect(await format(text, { ...rc, filepath: file }), file).toBe(text);
    }
  });

  it('formats the R2 variant too', async () => {
    await add('deploy-cloudflare', '--option', 'deploy-cloudflare.r2Proxy=true');
    const rc = JSON.parse(await read('.prettierrc.json')) as Record<string, unknown>;
    for (const file of [
      'apps/shell/wrangler.jsonc',
      'apps/shell/worker/registry-proxy.ts',
      'deploy/r2-cors.json',
      'docs/cloudflare.md',
    ]) {
      const text = await read(file);
      expect(await format(text, { ...rc, filepath: file }), file).toBe(text);
    }
  });

  it('keeps mfeflow validate and doctor passing', async () => {
    await add('deploy-cloudflare');
    expect(await main(['validate', '--cwd', project], testRuntime())).toBe(0);
    expect(await main(['doctor', '--cwd', project], testRuntime())).toBe(0);
  });
});

describe('deploy-cloudflare with ci-github', () => {
  const workflowFile = '.github/workflows/deploy-cloudflare.yml';

  async function workflow(): Promise<{ text: string; doc: Record<string, unknown> }> {
    expect(await add('ci-github')).toBe(0);
    expect(await add('deploy-cloudflare')).toBe(0);
    const text = await read(workflowFile);
    return { text, doc: parse(text) as Record<string, unknown> };
  }

  it('writes the workflow only when ci-github is in the project', async () => {
    await add('deploy-cloudflare');
    expect(await readTree(project)).not.toHaveProperty([workflowFile]);
    await forget('deploy-cloudflare');
    expect((await workflow()).text).toContain('cloudflare/wrangler-action');
  });

  it('pins every action to a commit SHA', async () => {
    const { text } = await workflow();
    const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? '');
    expect(uses.length).toBeGreaterThan(5);
    for (const use of uses) expect(use).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
    expect(text).toMatch(/cloudflare\/wrangler-action@[0-9a-f]{40} # v\d/);
  });

  it('starts with no permissions, gives jobs contents: read only, and reads secrets from the environment', async () => {
    const { doc, text } = await workflow();
    expect(doc.permissions).toEqual({});
    const jobs = obj(doc.jobs);
    expect(Object.keys(jobs)).toEqual(['plan', 'build', 'deploy']);
    for (const job of Object.values(jobs))
      expect(obj(job).permissions).toEqual({ contents: 'read' });
    expect(text).toContain('apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(text).toContain('accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
    expect(text).toContain('environment: cloudflare-${{ matrix.target.env }}');
  });

  it('builds once and deploys a matrix of apps and environments', async () => {
    const { doc } = await workflow();
    const jobs = obj(doc.jobs);
    expect(obj(jobs.deploy).needs).toEqual(['plan', 'build']);
    expect(obj(obj(jobs.deploy).strategy).matrix).toEqual({
      target: '${{ fromJSON(needs.plan.outputs.targets) }}',
    });
    const buildRuns = (obj(jobs.build).steps as { run?: string }[]).map((s) => s.run);
    expect(buildRuns.filter((r) => r === 'pnpm build')).toHaveLength(1);
    const deployRuns = (obj(jobs.deploy).steps as { run?: string }[]).map((s) => s.run ?? '');
    expect(deployRuns.some((r) => r.includes('pnpm build'))).toBe(false);
  });

  it('never interpolates an expression into a run block', async () => {
    const { doc } = await workflow();
    for (const job of Object.values(obj(doc.jobs))) {
      for (const step of obj(job).steps as { run?: string; env?: Record<string, string> }[]) {
        if (step.run !== undefined) expect(step.run, step.run).not.toContain('${{');
      }
    }
    const steps = obj(obj(doc.jobs).deploy).steps as {
      name?: string;
      env?: Record<string, string>;
    }[];
    const stage = steps.find((s) => s.name === 'Stage the build for this environment');
    expect(stage?.env).toEqual({
      DEPLOY_ENV: '${{ matrix.target.env }}',
      DEPLOY_APP: '${{ matrix.target.app }}',
    });
  });
});

describe('deploy-cloudflare with the R2 proxy', () => {
  const addR2 = () => add('deploy-cloudflare', '--option', 'deploy-cloudflare.r2Proxy=true');

  it('adds the Worker and CORS file, and repeats the bindings in every environment', async () => {
    expect(await addR2()).toBe(0);
    const tree = await readTree(project);
    expect(tree).toHaveProperty(['apps/shell/worker/registry-proxy.ts']);
    expect(tree).toHaveProperty(['deploy/r2-cors.json']);
    expect(tree).not.toHaveProperty(['apps/cart/wrangler.jsonc']);
    expect(
      parseHeaders(await read('apps/shell/public/_headers')).map((r) => r.pattern),
    ).not.toContain('/registry/*');
    const shell = parseJsonc(await read('apps/shell/wrangler.jsonc'));
    expect(shell.main).toBe('worker/registry-proxy.ts');
    expect(obj(shell.assets).run_worker_first).toEqual(['/registry/*']);
    for (const [name, env] of Object.entries(obj(shell.env))) {
      expect(obj(obj(env).vars).MFE_ENV, name).toBe(name);
      expect(obj(env).r2_buckets, name).toEqual([
        { binding: 'REGISTRY', bucket_name: `app-registry-${name}` },
      ]);
      expect(obj(obj(env).assets).run_worker_first, name).toEqual(['/registry/*']);
    }
    expect(JSON.parse(await read('deploy/r2-cors.json'))).toHaveProperty(['rules']);
    expect(JSON.parse(await read('deploy/cloudflare.json'))).toHaveProperty(['registry'], 'r2');
    expect(await read('docs/cloudflare.md')).toContain(
      'wrangler r2 bucket cors set app-registry-prod',
    );
  });

  it('serves the index no-cache and versioned files immutable from the bucket', async () => {
    await addR2();
    const driver = `
      import worker from './apps/shell/worker/registry-proxy.ts';
      const objects = { 'envs/prod/index.json': '{"remotes":[]}', 'catalog/1.2.0/static/a.js': 'x' };
      const file = (key) => key in objects
        ? { body: objects[key], httpEtag: '"e"', writeHttpMetadata: () => undefined }
        : null;
      const env = {
        MFE_ENV: 'prod',
        REGISTRY: { get: async (key) => file(key), head: async (key) => file(key) },
      };
      const results = {};
      for (const [url, method] of [
        ['/registry/index.json', 'GET'],
        ['/registry/catalog/1.2.0/static/a.js', 'GET'],
        ['/registry/envs/prod/index.json', 'GET'],
        ['/registry/missing/1.0.0/x.js', 'GET'],
        ['/registry/index.json', 'POST'],
        ['/registry/index.json', 'HEAD'],
      ]) {
        const res = await worker.fetch(new Request('https://shop.test' + url, { method }), env);
        results[method + ' ' + url] = [res.status, res.headers.get('Cache-Control')];
      }
      console.log(JSON.stringify(results));
    `;
    await fs.writeFile(path.join(project, 'proxy-driver.mjs'), driver);
    const run = spawnSync(process.execPath, ['--experimental-strip-types', 'proxy-driver.mjs'], {
      cwd: project,
      env: cleanEnv(),
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      'GET /registry/index.json': [200, 'no-cache'],
      'GET /registry/catalog/1.2.0/static/a.js': [200, 'public, max-age=31536000, immutable'],
      'GET /registry/envs/prod/index.json': [404, null],
      'GET /registry/missing/1.0.0/x.js': [404, null],
      'POST /registry/index.json': [405, null],
      'HEAD /registry/index.json': [200, 'no-cache'],
    });
  });

  it('deploys only the shell and writes no registry index into it', async () => {
    await addR2();
    await fakeBuild({ shell: 'https://shop.acme.dev' });
    const run = runScript(['staging', '--dry-run']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('staged shell for staging');
    expect(run.stdout).not.toContain('staged cart');
    const tree = await readTree(path.join(project, 'apps/shell/.mfeflow/cloudflare/staging'));
    expect(tree).not.toHaveProperty(['registry/index.json']);
  });
});

/** An environment without the GIT_* variables a hook sets, which would point git at the wrong repo. */
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

const runScript = (args: string[]) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/deploy-cloudflare.ts', ...args],
    { cwd: project, env: cleanEnv(), encoding: 'utf8' },
  );

async function writeConfig(envs: Record<string, unknown>, registry = 'assets'): Promise<void> {
  await fs.writeFile(
    path.join(project, 'deploy/cloudflare.json'),
    JSON.stringify({ registry, envs }),
  );
}

/** Fake finished builds: what rsbuild leaves in each dist, plus the shell's per-environment configs. */
async function fakeBuild(shell?: { shell: string }): Promise<void> {
  const put = async (file: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await fs.writeFile(path.join(project, file), text);
  };
  const tree = await readTree(project);
  const headers = (app: string) => tree[`apps/${app}/public/_headers`] ?? '';
  await put('apps/shell/dist/index.html', '<html></html>');
  await put('apps/shell/dist/_headers', headers('shell'));
  for (const env of ['dev', 'staging', 'prod']) {
    await put(`apps/shell/dist/config/runtime-config.${env}.json`, `{"environment":"${env}"}`);
  }
  for (const remote of ['catalog', 'cart']) {
    await put(`apps/${remote}/dist/mf-manifest.json`, '{}');
    await put(`apps/${remote}/dist/static/js/${remote}.abc123.js`, '');
    await put(`apps/${remote}/dist/_headers`, headers(remote));
    await put(`apps/${remote}/package.json`, JSON.stringify({ name: remote, version: '1.2.0' }));
  }
  if (shell !== undefined) {
    const remotes = { catalog: 'https://catalog.acme.dev', cart: 'https://cart.acme.dev' };
    await writeConfig(
      { staging: { ...shell, remotes }, prod: { ...shell, remotes } },
      tree['deploy/cloudflare.json']?.includes('"r2"') ? 'r2' : 'assets',
    );
  }
}

describe('scripts/deploy-cloudflare.ts', () => {
  beforeEach(async () => {
    await add('deploy-cloudflare');
  });

  it('stages each app for one environment from the same build, and prints the wrangler commands', async () => {
    await fakeBuild({ shell: 'https://shop.acme.dev' });
    const run = runScript(['prod', '--dry-run']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(
      'pnpm exec wrangler deploy --config apps/shell/wrangler.jsonc --env prod',
    );
    expect(run.stdout).toContain('--config apps/cart/wrangler.jsonc --env prod');

    const shell = path.join(project, 'apps/shell/.mfeflow/cloudflare/prod');
    expect(
      JSON.parse(await fs.readFile(path.join(shell, 'config/runtime-config.json'), 'utf8')),
    ).toEqual({
      environment: 'prod',
      registryOrigins: ['https://catalog.acme.dev', 'https://cart.acme.dev'],
    });
    expect(Object.keys(await readTree(path.join(shell, 'config')))).toEqual([
      'runtime-config.json',
    ]);
    const index = JSON.parse(
      await fs.readFile(path.join(shell, 'registry/index.json'), 'utf8'),
    ) as {
      env: string;
      remotes: { name: string; version: string; entry: string; routes: string[] }[];
    };
    expect(index.env).toBe('prod');
    expect(index.remotes).toContainEqual({
      name: 'catalog',
      version: '1.2.0',
      entry: 'https://catalog.acme.dev/mf-manifest.json',
      routes: ['/catalog'],
    });

    const remoteHeaders = await fs.readFile(
      path.join(project, 'apps/cart/.mfeflow/cloudflare/prod/_headers'),
      'utf8',
    );
    expect(remoteHeaders).toContain('Access-Control-Allow-Origin: https://shop.acme.dev');
    expect(remoteHeaders).not.toContain('__SHELL_ORIGIN__');
    expect(await read('apps/cart/dist/_headers')).toContain('__SHELL_ORIGIN__');
  });

  it('stages only the apps it is given, and the build in dist is left alone', async () => {
    await fakeBuild({ shell: 'https://shop.acme.dev' });
    const run = runScript(['staging', 'catalog', '--prepare-only']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).not.toContain('staged shell');
    expect(run.stdout).not.toContain('wrangler');
    expect(await read('apps/shell/dist/config/runtime-config.staging.json')).toContain('staging');
  });

  it.each([
    ['empty', '', 'is empty'],
    ['a placeholder', 'https://shop.example.com', 'placeholder'],
    ['plain http', 'http://shop.acme.dev', 'https'],
    ['a path', 'https://shop.acme.dev/app', 'without a path'],
  ])('refuses a shell address that is %s', async (_name, shell, message) => {
    await fakeBuild({ shell });
    const run = runScript(['prod', '--prepare-only']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(message);
    expect(run.stderr).toContain('envs.prod.shell');
  });

  it('refuses a remote build that has no _headers, since the shell could not load it', async () => {
    await fakeBuild({ shell: 'https://shop.acme.dev' });
    await fs.rm(path.join(project, 'apps/cart/dist/_headers'));
    const run = runScript(['prod', 'cart', '--prepare-only']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('has no _headers');
    expect(run.stderr).toContain('apps/cart/public/_headers');
  });

  it('says which remote has no address yet', async () => {
    await fakeBuild({ shell: 'https://shop.acme.dev' });
    await writeConfig({
      prod: { shell: 'https://shop.acme.dev', remotes: { catalog: 'https://catalog.acme.dev' } },
    });
    const run = runScript(['prod', 'shell', '--prepare-only']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('envs.prod.remotes.cart');
  });

  it('asks for a build when dist is missing, and rejects an unknown environment or app', async () => {
    await writeConfig({ prod: { shell: 'https://shop.acme.dev', remotes: {} } });
    expect(runScript(['prod', 'shell', '--prepare-only']).stderr).toContain('Run the build first');
    expect(runScript(['qa']).stderr).toContain('usage');
    expect(runScript(['prod', 'nope']).stderr).toContain('not an app this project deploys');
  });

  it('plans one matrix entry per app and environment', async () => {
    const run = runScript(['plan', 'staging,prod']);
    expect(run.status, run.stderr).toBe(0);
    const targets = JSON.parse(run.stdout) as { app: string; env: string }[];
    expect(targets).toHaveLength(6);
    expect(targets).toContainEqual({ app: 'cart', env: 'prod' });
    expect(runScript(['plan', 'qa']).status).toBe(1);
  });
});
