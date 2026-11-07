import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../cli';
import { BASE_URL, buildRemote, fixture, type Fixture } from '../deploy-testing';
import { readTree, removeDir, tempDir, testRuntime } from '../testing';
import { runCli, type CliMain } from './capture';
import { capOutput } from './limits';
import { hashTargets, PlanStore } from './plans';
import { createMcpServer } from './server';

const dirs: string[] = [];
const clients: Client[] = [];
const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(dirs.splice(0).map(removeDir));
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

async function project(): Promise<string> {
  const dir = await tempDir('mfeflow-mcp-');
  dirs.push(dir);
  const code = await main(['init', 'app', '--yes', '--no-install', '--cwd', dir], testRuntime());
  expect(code).toBe(0);
  return path.join(dir, 'app');
}

async function connect(
  options: {
    registry?: boolean;
    now?: () => number;
    maxText?: number;
    main?: CliMain;
  } = {},
): Promise<Client> {
  const server = createMcpServer({
    main: options.main ?? main,
    allowRegistryWrites: options.registry === true,
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxText ? { maxText: options.maxText } : {}),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  clients.push(client);
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

interface Called {
  isError: boolean;
  data: Record<string, unknown>;
  text: string;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Called> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK types the result loosely
  const result = (await client.callTool({ name, arguments: args })) as {
    content?: { text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  return {
    isError: result.isError === true,
    data: { ...result.structuredContent },
    text: result.content?.[0]?.text ?? '',
  };
}

async function setRegistry(root: string, host: string): Promise<void> {
  const file = path.join(root, 'mfeflow.json');
  const json = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  json.registry = { host, baseUrl: BASE_URL };
  await fs.writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
}

/** A project with a registry host set, for tests that stand in for the CLI. */
async function hostedProject(): Promise<string> {
  const root = await project();
  await setRegistry(root, 'file:/srv/registry');
  return root;
}

type Doc = Record<string, unknown>;

/** A CLI that answers each call from `answer` and records the argv it was given. */
function stubCli(answer: (argv: string[], seen: string[][]) => Doc): {
  main: CliMain;
  seen: string[][];
} {
  const seen: string[][] = [];
  return {
    seen,
    main: (argv, rt) => {
      const list = [...argv];
      const doc = answer(list, seen);
      seen.push(list);
      rt.io.stdout(JSON.stringify(doc));
      return Promise.resolve(doc.ok === false ? 1 : 0);
    },
  };
}

const moveDoc = (servedBefore: string | null, version = '1.0.0'): Doc => ({
  ok: true,
  command: 'promote',
  root: '/nowhere',
  env: 'prod',
  fromEnv: 'staging',
  remote: 'catalog',
  version,
  servedBefore,
});

describe('tools/list', () => {
  it('has no registry tool without the flag', async () => {
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'mfeflow_inspect_project',
      'mfeflow_search_features',
      'mfeflow_validate',
      'mfeflow_doctor',
      'mfeflow_registry_status',
      'mfeflow_explain_error',
      'mfeflow_plan',
      'mfeflow_plan_diff',
      'mfeflow_apply_plan',
    ]);
  });

  it('adds the registry tools with the flag', async () => {
    const { tools } = await (await connect({ registry: true })).listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('mfeflow_registry_plan');
    expect(names).toContain('mfeflow_registry_apply');
  });

  it('asks for cwd on every tool and sets honest hints', async () => {
    const { tools } = await (await connect({ registry: true })).listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.required).toContain('cwd');
      expect(tool.inputSchema.properties).toHaveProperty('response_format');
      expect(tool.annotations?.openWorldHint).toBeTypeOf('boolean');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.mfeflow_inspect_project?.readOnlyHint).toBe(true);
    expect(byName.mfeflow_apply_plan?.readOnlyHint).toBe(false);
    expect(byName.mfeflow_apply_plan?.destructiveHint).toBe(true);
    expect(byName.mfeflow_registry_apply?.destructiveHint).toBe(true);
  });

  it('takes no credential argument on any tool', async () => {
    const { tools } = await (await connect({ registry: true })).listTools();
    for (const tool of tools) {
      const keys = Object.keys(tool.inputSchema.properties ?? {}).join(' ');
      expect(keys).not.toMatch(/token|secret|password|credential|key/i);
    }
  });
});

describe('cwd', () => {
  it('refuses a relative path, a missing folder and a file', async () => {
    const client = await connect();
    const root = await project();
    const relative = await call(client, 'mfeflow_inspect_project', { cwd: 'app' });
    expect(relative.isError).toBe(true);
    const missing = await call(client, 'mfeflow_inspect_project', {
      cwd: path.join(root, 'nope'),
    });
    expect(missing.isError).toBe(true);
    const file = await call(client, 'mfeflow_inspect_project', {
      cwd: path.join(root, 'mfeflow.json'),
    });
    expect(file.isError).toBe(true);
    expect(JSON.stringify(file.data)).toContain('not a folder');
  });

  it('reports a folder that is not a project as an error with a code', async () => {
    const dir = await tempDir('mfeflow-mcp-empty-');
    dirs.push(dir);
    const result = await call(await connect(), 'mfeflow_inspect_project', { cwd: dir });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.data)).toContain('MFEFLOW_E102');
  });
});

describe('read tools', () => {
  it('inspects the project', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_inspect_project', { cwd: root });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ topology: 'monorepo', kind: 'app', bundler: 'rsbuild' });
    expect(result.data.apps).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'shell', kind: 'shell' })]),
    );
    expect(JSON.parse(result.text)).toEqual(result.data);
    const detailed = await call(await connect(), 'mfeflow_inspect_project', {
      cwd: root,
      response_format: 'detailed',
    });
    expect(detailed.data).toHaveProperty('project');
  });

  it('works from a folder inside the project', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_inspect_project', {
      cwd: path.join(root, 'apps'),
    });
    expect(result.isError).toBe(false);
    expect(result.data.root).toBe(root);
  });

  it('searches features', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_search_features', {
      cwd: root,
      query: 'lint',
    });
    expect(result.isError).toBe(false);
    const names = (result.data.features as { name: string }[]).map((f) => f.name);
    expect(names).toContain('lint-oxlint');
  });

  it('refuses a search that looks like a flag', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_search_features', {
      cwd: root,
      query: '--cwd',
    });
    expect(result.isError).toBe(true);
  });

  it('validates', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_validate', { cwd: root });
    expect(result.data).toMatchObject({ command: 'validate', ok: true });
    expect(result.data).not.toHaveProperty('checks');
    const detailed = await call(await connect(), 'mfeflow_validate', {
      cwd: root,
      response_format: 'detailed',
    });
    expect(detailed.data).toHaveProperty('checks');
  });

  it('runs doctor and returns findings as a result, not an error', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_doctor', { cwd: root });
    expect(result.data).toMatchObject({ command: 'doctor' });
    expect(result.data).toHaveProperty('findings');
    expect(result.isError).toBe(false);
  });

  it('refuses an against value that looks like a flag', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_doctor', {
      cwd: root,
      against: '--fix',
    });
    expect(result.isError).toBe(true);
  });

  it('says plainly when no registry host is set up', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_registry_status', { cwd: root });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.data)).toContain('MFEFLOW_E506');
    expect(JSON.stringify(result.data)).toContain('registry.host');
    expect(JSON.stringify(result.data)).not.toContain('pass --host');
  });

  it('reads registry status from a host', async () => {
    const f = await fixture();
    fixtures.push(f);
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    await setRegistry(f.root, `file:${f.site}`);
    const result = await call(await connect(), 'mfeflow_registry_status', {
      cwd: f.root,
      env: 'prod',
    });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.data.envs)).toContain('1.0.0');
  });
});

describe('doctor against', () => {
  async function refused(against: string): Promise<void> {
    const root = await project();
    const cli = stubCli(() => ({ ok: true, command: 'doctor' }));
    const result = await call(await connect({ main: cli.main }), 'mfeflow_doctor', {
      cwd: root,
      against,
    });
    expect(result.isError, against).toBe(true);
    expect(cli.seen, against).toEqual([]);
  }

  it.each([
    'https://10.0.0.5/mf-manifest.json',
    'https://192.168.1.1/mf-manifest.json',
    'https://169.254.169.254/latest/meta-data',
    'http://localhost:8080/mf-manifest.json',
    'https://localhost/mf-manifest.json',
    'https://127.0.0.1/mf-manifest.json',
    'https://user:pw@example.com/mf-manifest.json',
    'https://example.com/mf-manifest.json?token=abc123',
    'ftp://example.com/x.json',
  ])('refuses %s', refused);

  it('refuses a file outside the project folder, by relative path, absolute path or symlink', async () => {
    const root = await project();
    const outside = await tempDir('mfeflow-mcp-outside-');
    dirs.push(outside);
    const file = path.join(outside, 'secret.json');
    await fs.writeFile(file, '{}');
    await fs.symlink(file, path.join(root, 'link.json'));
    const cli = stubCli(() => ({ ok: true, command: 'doctor' }));
    const client = await connect({ main: cli.main });
    for (const against of [
      '../outside.json',
      file,
      `file:${file}`,
      'link.json',
      path.join(root, 'missing.json'),
    ]) {
      const result = await call(client, 'mfeflow_doctor', { cwd: root, against });
      expect(result.isError, against).toBe(true);
    }
    expect(cli.seen).toEqual([]);
  });

  it('refuses an index whose shell manifest is a symlink to a file outside the project', async () => {
    const root = await project();
    const outside = await tempDir('mfeflow-mcp-outside-');
    dirs.push(outside);
    await fs.writeFile(path.join(outside, 'mf-manifest.json'), '{}');
    await fs.writeFile(path.join(root, 'index.json'), '{}');
    await fs.symlink(outside, path.join(root, 'shell'));
    const cli = stubCli(() => ({ ok: true, command: 'doctor' }));
    const result = await call(await connect({ main: cli.main }), 'mfeflow_doctor', {
      cwd: root,
      against: 'index.json',
    });
    expect(result.isError).toBe(true);
    expect(cli.seen).toEqual([]);
  });

  it('passes a file inside the project as its real path', async () => {
    const root = await project();
    await fs.writeFile(path.join(root, 'shell.json'), '{}');
    const cli = stubCli(() => ({ ok: true, command: 'doctor' }));
    const result = await call(await connect({ main: cli.main }), 'mfeflow_doctor', {
      cwd: root,
      against: 'shell.json',
    });
    expect(result.isError).toBe(false);
    expect(cli.seen[0]?.slice(0, 3)).toEqual([
      'doctor',
      '--against',
      await fs.realpath(path.join(root, 'shell.json')),
    ]);
  });

  it('refuses a request to a private address that a public host redirects to', async () => {
    const root = await project();
    const seen: string[] = [];
    const guarded = await runCli(
      (argv, rt) => {
        try {
          void rt.fetch('https://127.0.0.1/x', {});
        } catch (error) {
          seen.push(String(error));
        }
        rt.io.stdout(JSON.stringify({ ok: true, argv }));
        return Promise.resolve(0);
      },
      ['doctor'],
      root,
      {},
      (url) => {
        if (new URL(url).hostname === '127.0.0.1') throw new Error('private');
      },
    );
    expect(guarded.code).toBe(0);
    expect(seen.join()).toContain('private');
  });
});

describe('inspect redaction', () => {
  it('hides tokens in registries, shell and registry settings in the detailed answer', async () => {
    const root = await project();
    const file = path.join(root, 'mfeflow.json');
    const json = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    json.registries = { '@acme': 'https://reg.example.com/{name}.json?token=sekret123' };
    json.shell = 'https://shell.example.com/mf-manifest.json';
    await fs.writeFile(file, JSON.stringify(json, null, 2));
    const result = await call(await connect(), 'mfeflow_inspect_project', {
      cwd: root,
      response_format: 'detailed',
    });
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain('sekret123');
    expect(JSON.stringify(result.data)).toContain('@acme');
  });
});

describe('mfeflow_explain_error', () => {
  it('explains a known code in any spelling', async () => {
    const root = await project();
    const client = await connect();
    for (const code of ['MFEFLOW_E101', 'E101', 'e101']) {
      const result = await call(client, 'mfeflow_explain_error', { cwd: root, code });
      const errors = result.data.errors as Record<string, string>[];
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('MFEFLOW_E101');
      expect(errors[0]?.title).toContain('singleton');
      expect(errors[0]?.fix).toContain('doctor');
      expect(errors[0]?.docs).toContain('E101');
    }
  });

  it('finds each code once in a pasted log and lists unknown ones', async () => {
    const root = await project();
    const log = [
      'build failed',
      'MFEFLOW_E101 A shared singleton is missing',
      'again MFEFLOW_E101',
      'also MFEFLOW_E604 and MFEFLOW_E999',
      'plain E102 is not a code here',
    ].join('\n');
    const result = await call(await connect(), 'mfeflow_explain_error', { cwd: root, log });
    const codes = (result.data.errors as { code: string }[]).map((e) => e.code);
    expect(codes).toEqual(['MFEFLOW_E101', 'MFEFLOW_E604']);
    expect(result.data.unknown).toEqual(['MFEFLOW_E999']);
  });

  it('needs a code or a log', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_explain_error', { cwd: root });
    expect(result.isError).toBe(true);
  });
});

describe('plan and apply', () => {
  it('plans add remote, then applies it', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    expect(plan.isError).toBe(false);
    expect(plan.data.plan_id).toBeTypeOf('string');
    expect(plan.data.diff).toContain('reviews');
    expect(Date.parse(String(plan.data.expires_at))).toBeGreaterThan(Date.now());
    expect(existsSync(path.join(root, 'apps', 'reviews'))).toBe(false);

    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(false);
    expect(applied.data.ok).toBe(true);
    expect(existsSync(path.join(root, 'apps', 'reviews', 'package.json'))).toBe(true);
    const after = await call(client, 'mfeflow_inspect_project', { cwd: root });
    expect((after.data.apps as { name: string }[]).map((a) => a.name)).toContain('reviews');
  });

  it('applies a plan once', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const args = { cwd: root, plan_id: plan.data.plan_id };
    expect((await call(client, 'mfeflow_apply_plan', args)).isError).toBe(false);
    expect((await call(client, 'mfeflow_apply_plan', args)).isError).toBe(true);
  });

  it('plans a feature and an init without writing anything', async () => {
    const root = await project();
    const client = await connect();
    const feature = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_feature',
      features: ['url-factory'],
    });
    expect(feature.isError).toBe(false);
    expect(feature.data.command).toContain('add url-factory');
    const init = await call(client, 'mfeflow_plan', {
      cwd: path.dirname(root),
      kind: 'init',
      name: 'second',
      remotes: ['catalog'],
    });
    expect(init.isError).toBe(false);
    expect(existsSync(path.join(path.dirname(root), 'second'))).toBe(false);
  });

  it('plans an upgrade', async () => {
    const root = await project();
    const result = await call(await connect(), 'mfeflow_plan', { cwd: root, kind: 'upgrade' });
    expect(result.isError).toBe(false);
    expect(result.data.command).toBe('mfeflow upgrade --no-install');
  });

  it('refuses a plan with a missing argument or a name that looks like a flag', async () => {
    const root = await project();
    const client = await connect();
    expect((await call(client, 'mfeflow_plan', { cwd: root, kind: 'add_remote' })).isError).toBe(
      true,
    );
    const flag = await client.callTool({
      name: 'mfeflow_plan',
      arguments: { cwd: root, kind: 'add_remote', name: '--yes' },
    });
    expect(flag.isError).toBe(true);
  });

  it.each(['remote', 'shell', 'env-key', 'team-repo'])(
    'does not let add_feature reach the add %s subcommand',
    async (word) => {
      const root = await project();
      const cli = stubCli(() => ({ ok: true }));
      const client = await connect({ main: cli.main });
      const result = await call(client, 'mfeflow_plan', {
        cwd: root,
        kind: 'add_feature',
        features: [word, 'reviews'],
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.data)).toContain('subcommand');
      expect(cli.seen).toEqual([]);
    },
  );

  it('reads a long init diff back page by page, equal to the CLI dry run', async () => {
    const root = await project();
    const parent = path.dirname(root);
    const client = await connect();
    const args = { kind: 'init', name: 'big', remotes: ['catalog', 'cart'] };
    const plan = await call(client, 'mfeflow_plan', { cwd: parent, ...args });
    expect(plan.isError).toBe(false);
    const pages = Number(plan.data.diff_pages);
    expect(pages).toBeGreaterThan(1);
    expect(plan.data.diff_page).toBe(1);
    expect(String(plan.data.diff_note)).toContain('mfeflow_plan_diff');
    expect(plan.data.plan_id).toBeTypeOf('string');

    let joined = String(plan.data.diff);
    for (let page = 2; page <= pages; page += 1) {
      const next = await call(client, 'mfeflow_plan_diff', {
        cwd: parent,
        plan_id: plan.data.plan_id,
        page,
      });
      expect(next.isError).toBe(false);
      expect(next.data.truncated).toBeUndefined();
      joined += String(next.data.diff);
    }
    const direct = await runCli(
      main,
      [
        'init',
        'big',
        '--remotes',
        'catalog,cart',
        '--no-install',
        '--dry-run',
        '--json',
        '--cwd',
        parent,
      ],
      parent,
    );
    expect(joined).toBe((direct.json as { diff: string }).diff);
    const beyond = await call(client, 'mfeflow_plan_diff', {
      cwd: parent,
      plan_id: plan.data.plan_id,
      page: pages + 1,
    });
    expect(beyond.isError).toBe(true);
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: parent,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(false);
  });

  it('refuses a diff read from another folder or for an unknown plan', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const wrong = await call(client, 'mfeflow_plan_diff', {
      cwd: path.join(root, 'apps'),
      plan_id: plan.data.plan_id,
    });
    expect(wrong.isError).toBe(true);
    const unknown = await call(client, 'mfeflow_plan_diff', {
      cwd: root,
      plan_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.isError).toBe(true);
  });

  it('lists every written file with a count, and says how many are not listed', async () => {
    const root = await project();
    const written = Array.from({ length: 450 }, (_, i) => `apps/a/f${String(i)}.txt`);
    const cli = stubCli((argv) => ({
      ok: true,
      command: 'add',
      root,
      plan: { changes: [] },
      diff: '',
      written: argv.includes('--yes') ? written : [],
    }));
    const client = await connect({ main: cli.main });
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.data.written_count).toBe(450);
    expect(applied.data.written_omitted).toBe(250);
    expect(applied.data.written as string[]).toHaveLength(200);
    expect(JSON.stringify(applied.data)).not.toContain('more items not shown');
  });

  it('refuses a feature add whose dry run changed since the plan', async () => {
    const root = await project();
    let version = 'one';
    const cli = stubCli(() => ({
      ok: true,
      command: 'add',
      root,
      plan: { changes: [{ path: 'a.txt', action: 'create' }] },
      diff: `+${version}`,
    }));
    const client = await connect({ main: cli.main });
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_feature',
      features: ['@acme/thing'],
    });
    version = 'two';
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(JSON.stringify(applied.data)).toContain('no longer what was planned');
    expect(cli.seen.some((argv) => argv.includes('--yes'))).toBe(false);
  });

  it('refuses an expired plan', async () => {
    const root = await project();
    let now = 1_000_000;
    const client = await connect({ now: () => now });
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    now += 10 * 60 * 1000 + 1;
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(JSON.stringify(applied.data)).toContain('expired');
    expect(existsSync(path.join(root, 'apps', 'reviews'))).toBe(false);
  });

  it('still applies a plan just before it expires', async () => {
    const root = await project();
    let now = 1_000_000;
    const client = await connect({ now: () => now });
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    now += 10 * 60 * 1000 - 1;
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(false);
  });

  it('refuses when a target file changed after the plan', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const file = path.join(root, 'mfeflow.json');
    await fs.writeFile(file, `${await fs.readFile(file, 'utf8')}\n`);
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(JSON.stringify(applied.data)).toContain('changed after the plan');
    expect(existsSync(path.join(root, 'apps', 'reviews'))).toBe(false);
  });

  it('refuses when a file the plan would create appeared', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    await fs.mkdir(path.join(root, 'apps', 'reviews'), { recursive: true });
    await fs.writeFile(path.join(root, 'apps', 'reviews', 'package.json'), '{}');
    const before = await readTree(root);
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(await readTree(root)).toEqual(before);
    expect(await fs.readdir(path.join(root, 'apps', 'reviews'))).toEqual(['package.json']);
  });

  it('does not burn a plan on a call from the wrong folder', async () => {
    const root = await project();
    const client = await connect();
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const wrong = await call(client, 'mfeflow_apply_plan', {
      cwd: path.join(root, 'apps'),
      plan_id: plan.data.plan_id,
    });
    expect(wrong.isError).toBe(true);
    const right = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(right.isError).toBe(false);
  });

  it('does not let a registry plan be taken by the local apply and burn it', async () => {
    const store = new PlanStore();
    const plan = store.add({ scope: 'registry', cwd: '/a', argv: [], hashes: {} });
    await expect(store.take(plan.id, 'local', '/a')).rejects.toThrow();
    await expect(store.take(plan.id, 'registry', '/a')).resolves.toMatchObject({ id: plan.id });
  });

  it('refuses when a path the plan would skip changed', async () => {
    const root = await project();
    const cli = stubCli(() => ({
      ok: true,
      command: 'add',
      root,
      plan: { changes: [], skipped: [{ path: 'notes.txt' }] },
      diff: '',
    }));
    const client = await connect({ main: cli.main });
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_feature',
      features: ['url-factory'],
    });
    await fs.writeFile(path.join(root, 'notes.txt'), 'new');
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(JSON.stringify(applied.data)).toContain('notes.txt');
  });

  it('notices a symlink pointed somewhere else with the same content', async () => {
    const dir = await tempDir('mfeflow-mcp-link-');
    dirs.push(dir);
    await fs.writeFile(path.join(dir, 'one.txt'), 'same');
    await fs.writeFile(path.join(dir, 'two.txt'), 'same');
    const link = path.join(dir, 'link.txt');
    await fs.symlink('one.txt', link);
    const store = new PlanStore();
    const plan = store.add({
      scope: 'local',
      cwd: dir,
      argv: [],
      hashes: await hashTargets(dir, ['link.txt', 'later/new.txt']),
    });
    await fs.rm(link);
    await fs.symlink('two.txt', link);
    await expect(store.take(plan.id, 'local', dir)).rejects.toThrow('changed after the plan');
  });

  it('notices a symlinked folder that appeared where a file was absent', async () => {
    const dir = await tempDir('mfeflow-mcp-dirlink-');
    dirs.push(dir);
    const elsewhere = await tempDir('mfeflow-mcp-elsewhere-');
    dirs.push(elsewhere);
    const store = new PlanStore();
    const plan = store.add({
      scope: 'local',
      cwd: dir,
      argv: [],
      hashes: await hashTargets(dir, ['sub/file.txt']),
    });
    await fs.symlink(elsewhere, path.join(dir, 'sub'));
    await expect(store.take(plan.id, 'local', dir)).rejects.toThrow('changed after the plan');
  });

  it('refuses an unknown id, and a plan applied from another folder', async () => {
    const root = await project();
    const client = await connect();
    const unknown = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.isError).toBe(true);
    const plan = await call(client, 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
    });
    const elsewhere = await call(client, 'mfeflow_apply_plan', {
      cwd: path.join(root, 'apps'),
      plan_id: plan.data.plan_id,
    });
    expect(elsewhere.isError).toBe(true);
    expect(JSON.stringify(elsewhere.data)).toContain('was made for');
  });

  it('does not let mfeflow_apply_plan run a registry plan', async () => {
    const { f, client } = await deployed();
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: f.root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    expect(plan.data.plan_id).toBeTypeOf('string');
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: f.root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
  });
});

/** A project with catalog 1.0.0 and then 2.0.0 live in prod on a file host. */
async function deployed(): Promise<{ f: Fixture; client: Client }> {
  const f = await fixture();
  fixtures.push(f);
  await buildRemote(f.root, 'catalog', '1.0.0');
  await f.run('deploy', 'catalog', '--env', 'prod');
  await buildRemote(f.root, 'catalog', '2.0.0');
  await f.run('deploy', 'catalog', '--env', 'prod');
  expect((await f.served('prod'))?.version).toBe('2.0.0');
  await setRegistry(f.root, `file:${f.site}`);
  return { f, client: await connect({ registry: true }) };
}

describe('registry tools', () => {
  it('takes no host argument and never passes one to the CLI', async () => {
    const root = await hostedProject();
    const { tools } = await (await connect({ registry: true })).listTools();
    for (const name of ['mfeflow_registry_status', 'mfeflow_registry_plan']) {
      expect(tools.find((t) => t.name === name)?.inputSchema.properties).not.toHaveProperty('host');
    }
    const cli = stubCli(() => moveDoc('0.9.0'));
    const client = await connect({ registry: true, main: cli.main });
    await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'promote',
      remote: 'catalog',
      from: 'staging',
      to: 'prod',
      host: 's3://attacker-bucket',
    });
    await call(client, 'mfeflow_registry_status', { cwd: root, host: 's3://attacker-bucket' });
    expect(cli.seen.length).toBeGreaterThan(0);
    for (const argv of cli.seen) expect(argv).not.toContain('--host');
  });

  it('says to set registry.host when the project has none', async () => {
    const root = await project();
    const result = await call(await connect({ registry: true }), 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.data)).toContain('set registry.host in mfeflow.json');
  });

  it('needs the right fields for each kind', async () => {
    const root = await project();
    const client = await connect({ registry: true });
    const promote = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'promote',
      remote: 'catalog',
    });
    expect(promote.isError).toBe(true);
    const rollback = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'rollback',
      remote: 'catalog',
    });
    expect(rollback.isError).toBe(true);
  });

  it('plans a rollback without touching the host, then applies it', async () => {
    const { f, client } = await deployed();
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: f.root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    expect(plan.isError).toBe(false);
    expect(plan.data).toMatchObject({ version: '1.0.0', servedBefore: '2.0.0' });
    expect((await f.served('prod'))?.version).toBe('2.0.0');

    const applied = await call(client, 'mfeflow_registry_apply', {
      cwd: f.root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(false);
    expect(applied.data).toMatchObject({ ok: true, published: true });
    expect((await f.served('prod'))?.version).toBe('1.0.0');
  });

  it('refuses to apply a registry plan after the project file changed', async () => {
    const { f, client } = await deployed();
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: f.root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    const file = path.join(f.root, 'mfeflow.json');
    await fs.writeFile(file, `${await fs.readFile(file, 'utf8')}\n`);
    const applied = await call(client, 'mfeflow_registry_apply', {
      cwd: f.root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect((await f.served('prod'))?.version).toBe('2.0.0');
  });

  it('pins a rollback to the version planned and refuses after a newer deploy', async () => {
    const { f, client } = await deployed();
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: f.root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    expect(plan.data.command).toContain('--to 1.0.0');
    await buildRemote(f.root, 'catalog', '3.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    const applied = await call(client, 'mfeflow_registry_apply', {
      cwd: f.root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect((await f.served('prod'))?.version).toBe('3.0.0');
  });

  it('stores the version a rollback resolved to in the command it will run', async () => {
    const root = await hostedProject();
    const cli = stubCli(() => ({ ...moveDoc('2.0.0'), command: 'rollback' }));
    const client = await connect({ registry: true, main: cli.main });
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'rollback',
      remote: 'catalog',
      env: 'prod',
    });
    await call(client, 'mfeflow_registry_apply', { cwd: root, plan_id: plan.data.plan_id });
    const ran = cli.seen.at(-1) ?? [];
    expect(ran.slice(0, 6)).toEqual(['rollback', 'catalog', '--env', 'prod', '--to', '1.0.0']);
    expect(ran).toContain('--yes');
  });

  it.each([
    ['the target env now serves another version', '0.9.5', '1.0.0'],
    ['the source env now serves another version', '0.9.0', '1.1.0'],
  ])('refuses a promote when %s', async (_why, servedBefore, version) => {
    const root = await hostedProject();
    let drifted = false;
    const cli = stubCli(() => (drifted ? moveDoc(servedBefore, version) : moveDoc('0.9.0')));
    const client = await connect({ registry: true, main: cli.main });
    const plan = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'promote',
      remote: 'catalog',
      from: 'staging',
      to: 'prod',
    });
    expect(plan.isError).toBe(false);
    drifted = true;
    const applied = await call(client, 'mfeflow_registry_apply', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
    expect(JSON.stringify(applied.data)).toContain('no longer what was planned');
    expect(cli.seen.some((argv) => argv.includes('--yes'))).toBe(false);
  });

  it('makes no plan when the dry run fails a gate', async () => {
    const root = await hostedProject();
    const cli = stubCli(() => ({
      ok: false,
      command: 'promote',
      findings: [{ code: 'MFEFLOW_E101', message: 'gate failed' }],
    }));
    const client = await connect({ registry: true, main: cli.main });
    const result = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'promote',
      remote: 'catalog',
      from: 'staging',
      to: 'prod',
    });
    expect(result.isError).toBe(true);
    expect(result.data).not.toHaveProperty('plan_id');
    expect(JSON.stringify(result.data)).toContain('gate failed');
  });

  it('reports a failed dry run as an error with a code and makes no plan', async () => {
    const root = await hostedProject();
    const client = await connect({ registry: true });
    const result = await call(client, 'mfeflow_registry_plan', {
      cwd: root,
      kind: 'promote',
      remote: 'catalog',
      from: 'staging',
      to: 'prod',
    });
    expect(result.isError).toBe(true);
    expect(result.data).not.toHaveProperty('plan_id');
  });
});

describe('output cap', () => {
  it('leaves a small result alone', () => {
    const capped = capOutput({ a: 1 }, 1000);
    expect(capped.truncated).toBe(false);
    expect(JSON.parse(capped.text)).toEqual({ a: 1 });
  });

  it('shortens long text and long lists, and says so', () => {
    const capped = capOutput(
      { log: 'x'.repeat(50_000), list: Array.from({ length: 200 }, (_, i) => i) },
      40_000,
    );
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(40_000);
    expect(capped.text).toContain('more characters not shown');
    expect(capped.text).toContain('more items not shown');
    expect(capped.structured.truncated).toBe(true);
  });

  it('hard-cuts what is still too long', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`k${String(i)}`, 'y'.repeat(300)]),
    );
    const capped = capOutput(wide, 5000);
    expect(capped.text.length).toBeLessThanOrEqual(5000);
    expect(capped.text).toContain('Output was cut');
    expect(capped.structured.truncated).toBe(true);
    expect(capped.structured.plan_id).toBeUndefined();
  });

  it('keeps plan_id and other ids through the hard cut', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`k${String(i)}`, 'y'.repeat(300)]),
    );
    const capped = capOutput(
      { plan_id: 'abc-123', expires_at: 'soon', diff_pages: 4, ...wide },
      5000,
    );
    expect(capped.text.length).toBeLessThanOrEqual(5000);
    expect(capped.structured).toMatchObject({
      plan_id: 'abc-123',
      expires_at: 'soon',
      diff_pages: 4,
    });
    expect(JSON.parse(capped.text)).toMatchObject({ plan_id: 'abc-123' });
  });

  it('does not cut a diff page or a written list', () => {
    const diff = 'd'.repeat(12_000);
    const written = Array.from({ length: 200 }, (_, i) => `f${String(i)}`);
    const capped = capOutput({ diff, written }, 40_000);
    expect(capped.truncated).toBe(false);
  });

  it('caps a tool answer end to end', async () => {
    const root = await project();
    const result = await call(await connect({ maxText: 800 }), 'mfeflow_plan', {
      cwd: root,
      kind: 'add_remote',
      name: 'reviews',
      response_format: 'detailed',
    });
    expect(result.text.length).toBeLessThanOrEqual(800);
    expect(result.text).toContain('Output was cut');
    expect(result.data.truncated).toBe(true);
    expect(result.data.plan_id).toBeTypeOf('string');
    expect(result.text).toContain(String(result.data.plan_id));
  });
});

const built = path.resolve(import.meta.dirname, '../../dist/index.js');
const bin = path.resolve(import.meta.dirname, '../../bin/mfeflow.js');

// CI builds before it tests (`pnpm run ci`), so a missing build there is a failure, not a skip.
const skipStdio = !existsSync(built) && process.env.CI === undefined;
if (skipStdio) {
  console.warn(`SKIPPED the stdio tests: ${built} is missing. Run \`pnpm build\` first.`);
}

interface Rpc {
  id?: number;
  jsonrpc?: string;
  result?: { structuredContent?: Record<string, unknown>; isError?: boolean };
}

/** Talks to `mfeflow mcp` over its pipes and keeps every raw line it wrote to stdout. */
function rawSession(): {
  lines: string[];
  ask(id: number, method: string, params: object): Promise<Rpc>;
  notify(method: string): void;
  close(): Promise<void>;
} {
  const child = spawn(process.execPath, [bin, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = [];
  const waiting = new Map<number, (message: Rpc) => void>();
  let pending = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts.filter((l) => l !== '')) {
      lines.push(line);
      const message = JSON.parse(line) as Rpc;
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  return {
    lines,
    ask: (id, method, params) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 60_000);
        waiting.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`),
    close: () =>
      new Promise((resolve) => {
        child.on('close', () => resolve());
        child.stdin.end();
      }),
  };
}

describe.skipIf(skipStdio)('over stdio', () => {
  it('starts as `mfeflow mcp` and answers', async () => {
    const root = await project();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, 'mcp'],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '1' });
    clients.push(client);
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('mfeflow_registry_apply');
    const result = await call(client, 'mfeflow_inspect_project', { cwd: root });
    expect(result.data.topology).toBe('monorepo');
  });

  it('offers the registry tools only with the flag', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, 'mcp', '--allow-registry-writes'],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '1' });
    clients.push(client);
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('mfeflow_registry_apply');
  });

  it('plans and applies with nothing but JSON-RPC on stdout', async () => {
    const root = await project();
    const session = rawSession();
    await session.ask(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    session.notify('notifications/initialized');
    const planned = await session.ask(2, 'tools/call', {
      name: 'mfeflow_plan',
      arguments: { cwd: root, kind: 'add_remote', name: 'reviews' },
    });
    const planId = planned.result?.structuredContent?.plan_id;
    expect(planId).toBeTypeOf('string');
    expect(existsSync(path.join(root, 'apps', 'reviews'))).toBe(false);
    const applied = await session.ask(3, 'tools/call', {
      name: 'mfeflow_apply_plan',
      arguments: { cwd: root, plan_id: planId },
    });
    await session.close();
    expect(applied.result?.isError).toBeUndefined();
    expect(existsSync(path.join(root, 'apps', 'reviews', 'package.json'))).toBe(true);
    expect(session.lines.length).toBeGreaterThanOrEqual(3);
    for (const line of session.lines) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    }
  });
});
