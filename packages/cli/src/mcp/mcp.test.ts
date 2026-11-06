import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../cli';
import { buildRemote, fixture, type Fixture } from '../deploy-testing';
import { removeDir, tempDir, testRuntime } from '../testing';
import { capOutput } from './limits';
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
  options: { registry?: boolean; now?: () => number; maxText?: number } = {},
): Promise<Client> {
  const server = createMcpServer({
    main,
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
  });

  it('reads registry status from a host', async () => {
    const f = await fixture();
    fixtures.push(f);
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    const result = await call(await connect(), 'mfeflow_registry_status', {
      cwd: f.root,
      env: 'prod',
      host: `file:${f.site}`,
    });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.data.envs)).toContain('1.0.0');
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
    const applied = await call(client, 'mfeflow_apply_plan', {
      cwd: root,
      plan_id: plan.data.plan_id,
    });
    expect(applied.isError).toBe(true);
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
      host: `file:${f.site}`,
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
  return { f, client: await connect({ registry: true }) };
}

describe('registry tools', () => {
  it('rejects a host that carries credentials', async () => {
    const root = await project();
    const client = await connect({ registry: true });
    const result = await client.callTool({
      name: 'mfeflow_registry_plan',
      arguments: {
        cwd: root,
        kind: 'rollback',
        remote: 'catalog',
        env: 'prod',
        host: 's3://key:secret@bucket',
      },
    });
    expect(result.isError).toBe(true);
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
      host: `file:${f.site}`,
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
      host: `file:${f.site}`,
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

  it('reports a failed dry run as an error with a code and makes no plan', async () => {
    const root = await project();
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
      { diff: 'x'.repeat(50_000), list: Array.from({ length: 200 }, (_, i) => i) },
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
  });
});

const built = path.resolve(import.meta.dirname, '../../dist/index.js');

describe.skipIf(!existsSync(built))('over stdio', () => {
  it('starts as `mfeflow mcp` and answers', async () => {
    const root = await project();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(import.meta.dirname, '../../bin/mfeflow.js'), 'mcp'],
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
      args: [
        path.resolve(import.meta.dirname, '../../bin/mfeflow.js'),
        'mcp',
        '--allow-registry-writes',
      ],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '1' });
    clients.push(client);
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('mfeflow_registry_apply');
  });
});
