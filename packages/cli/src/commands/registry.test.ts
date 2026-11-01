import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addTrusted,
  loadProject,
  readTrusted,
  serializeProject,
  type MfeflowProject,
} from '@mfeflow/core';
import { main, validateResult, type RegistryResult } from '..';
import { removeDir, scriptedPrompter, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

const base: MfeflowProject = {
  version: 1,
  topology: 'monorepo',
  packageManager: 'pnpm',
  scope: '@acme',
  apps: { shell: { kind: 'shell', path: 'apps/shell', port: 4300 } },
  features: {},
};

async function projectWith(extra: Partial<MfeflowProject> = {}): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'mfeflow.json'), serializeProject({ ...base, ...extra }));
  return dir;
}

async function run(args: string[], cwd: string, rt = testRuntime()) {
  const code = await main(['registry', ...args, '--cwd', cwd], rt);
  return { code, rt, out: rt.io.out.join('\n'), err: rt.io.err.join('\n') };
}

function jsonOf(out: string[]): RegistryResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as RegistryResult;
}

const URL_A = 'https://acme.example/{name}.json';

describe('mfeflow registry add', () => {
  it('writes the namespace into mfeflow.json and says what to do next', async () => {
    const cwd = await projectWith();
    const { code, out } = await run(['add', '@acme', URL_A], cwd);
    expect(code).toBe(0);
    expect(out).toContain('Added @acme');
    expect(out).toContain('mfeflow features');
    expect((await loadProject(cwd)).registries).toEqual({ '@acme': URL_A });
    const text = await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8');
    expect(text).toContain('"$schema"');
  });

  it('keeps the registries it already has', async () => {
    const cwd = await projectWith({ registries: { '@one': 'https://one.example/{name}.json' } });
    await run(['add', '@acme', URL_A], cwd);
    expect(Object.keys((await loadProject(cwd)).registries ?? {})).toEqual(['@one', '@acme']);
  });

  it('prints one JSON document with --json, including the index it will read', async () => {
    const cwd = await projectWith();
    const rt = testRuntime();
    await main(['registry', 'add', '@acme', URL_A, '--json', '--cwd', cwd], rt);
    const result = jsonOf(rt.io.out);
    expect(result).toMatchObject({ action: 'add', changed: true, dryRun: false, root: cwd });
    expect(result.registries).toEqual([
      {
        namespace: '@acme',
        url: URL_A,
        index: 'https://acme.example/index.json',
        trusted: true,
      },
    ]);
  });

  it('writes nothing with --dry-run', async () => {
    const cwd = await projectWith();
    const before = await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8');
    const { code, out } = await run(['add', '@acme', URL_A, '--dry-run'], cwd);
    expect(code).toBe(0);
    expect(out).toContain('Dry run');
    expect(await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8')).toBe(before);
    const rt = testRuntime();
    await main(['registry', 'add', '@acme', URL_A, '--dry-run', '--json', '--cwd', cwd], rt);
    expect(jsonOf(rt.io.out)).toMatchObject({ dryRun: true, changed: true });
  });

  it('accepts plain http on a loopback host', async () => {
    const cwd = await projectWith();
    const url = 'http://127.0.0.1:4010/{name}.json';
    expect((await run(['add', '@test', url], cwd)).code).toBe(0);
    expect((await loadProject(cwd)).registries).toEqual({ '@test': url });
  });

  it.each([
    ['http://example.com/{name}.json', 'must be https'],
    ['http://localhost.evil.com/{name}.json', 'must be https'],
    ['http://localhost@evil.com/{name}.json', 'must be https'],
    ['https://example.com/feature.json', 'must contain {name}'],
    ['https://example.com/{id}/{name}.json', 'only {name} and {version}'],
    ['ftp://example.com/{name}.json', 'https'],
    ['https://u:p@example.com/{name}.json', 'user name or password'],
  ])('refuses %s and leaves mfeflow.json alone', async (url, why) => {
    const cwd = await projectWith();
    const before = await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8');
    const { code, err } = await run(['add', '@acme', url], cwd);
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
    expect(err).toContain(why);
    expect(await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8')).toBe(before);
  });

  it('refuses a reserved or malformed namespace and missing arguments', async () => {
    const cwd = await projectWith();
    expect((await run(['add', '@mfeflow', URL_A], cwd)).err).toContain('reserved');
    expect((await run(['add', 'acme', URL_A], cwd)).err).toContain('start with @');
    expect((await run(['add', '@Acme', URL_A], cwd)).err).toContain('not a namespace');
    expect((await run(['add'], cwd)).err).toContain('needs a namespace');
    expect((await run(['add', '@acme'], cwd)).err).toContain('needs a URL');
    expect((await run(['add', '@acme', URL_A, 'extra'], cwd)).err).toContain('unexpected "extra"');
  });

  it('does nothing when the same URL is already set, and asks to remove before changing it', async () => {
    const cwd = await projectWith({ registries: { '@acme': URL_A } });
    const same = await run(['add', '@acme', URL_A], cwd);
    expect(same.code).toBe(0);
    expect(same.out).toContain('already points');
    const rt = testRuntime();
    await main(['registry', 'add', '@acme', URL_A, '--json', '--cwd', cwd], rt);
    expect(jsonOf(rt.io.out).changed).toBe(false);
    const other = await run(['add', '@acme', 'https://other.example/{name}.json'], cwd);
    expect(other.code).toBe(2);
    expect(other.err).toContain('mfeflow registry remove @acme');
    expect((await loadProject(cwd)).registries).toEqual({ '@acme': URL_A });
  });

  it('is E102 outside a project', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const { code, err } = await run(['add', '@acme', URL_A], dir);
    expect(code).toBe(3);
    expect(err).toContain('MFEFLOW_E102');
  });
});

describe('mfeflow registry remove', () => {
  it('takes the namespace out, and the key with the last one', async () => {
    const cwd = await projectWith({
      registries: { '@one': 'https://one.example/{name}.json', '@acme': URL_A },
    });
    expect((await run(['remove', '@acme'], cwd)).out).toContain('Removed @acme');
    expect(Object.keys((await loadProject(cwd)).registries ?? {})).toEqual(['@one']);
    await run(['remove', '@one'], cwd);
    expect(await loadProject(cwd)).not.toHaveProperty('registries');
  });

  it('writes nothing with --dry-run', async () => {
    const cwd = await projectWith({ registries: { '@acme': URL_A } });
    const { out } = await run(['remove', '@acme', '--dry-run'], cwd);
    expect(out).toContain('Dry run: would remove @acme');
    expect((await loadProject(cwd)).registries).toEqual({ '@acme': URL_A });
  });

  it('refuses a namespace that is not there', async () => {
    const cwd = await projectWith();
    const { code, err } = await run(['remove', '@acme'], cwd);
    expect(code).toBe(2);
    expect(err).toContain('not in this project');
    expect((await run(['remove'], cwd)).err).toContain('needs a namespace');
  });

  it('refuses while a feature installed from it is in the project', async () => {
    const cwd = await projectWith({
      registries: { '@acme': URL_A },
      features: { '@acme/segment': { version: '1.0.0' }, '@acmex/other': { version: '1.0.0' } },
    });
    const { code, err } = await run(['remove', '@acme'], cwd);
    expect(code).toBe(2);
    expect(err).toContain('@acme/segment installed from @acme');
    expect(err).not.toContain('@acmex/other installed');
    expect((await loadProject(cwd)).registries).toEqual({ '@acme': URL_A });
  });
});

describe('mfeflow registry list', () => {
  it('says how to add the first one', async () => {
    const { out } = await run(['list'], await projectWith());
    expect(out).toContain('No registries. Add one: mfeflow registry add');
  });

  it('lists namespaces with their URLs, sorted', async () => {
    const cwd = await projectWith({
      registries: { '@zed': 'https://zed.example/{name}.json', '@acme': URL_A },
    });
    const { out } = await run(['list'], cwd);
    expect(out.split('\n')).toEqual([
      `  @acme  ${URL_A}  [not trusted yet]`,
      '  @zed   https://zed.example/{name}.json  [not trusted yet]',
      '',
      'Trust one with: mfeflow registry trust @namespace',
    ]);
    const rt = testRuntime();
    await main(['registry', 'list', '--json', '--cwd', cwd], rt);
    const result = jsonOf(rt.io.out);
    expect(result.registries.map((r) => r.namespace)).toEqual(['@acme', '@zed']);
    expect(result.changed).toBe(false);
  });
});

describe('mfeflow registry add trusts what it adds', () => {
  it('records the namespace and URL in the user trust file, not in the project', async () => {
    const cwd = await projectWith();
    const rt = testRuntime();
    expect((await run(['add', '@acme', URL_A], cwd, rt)).code).toBe(0);
    expect(await readTrusted(rt.configDir)).toEqual([{ namespace: '@acme', template: URL_A }]);
    expect(await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8')).not.toContain('trusted');
  });

  it('does not trust anything with --dry-run', async () => {
    const cwd = await projectWith();
    const rt = testRuntime();
    const { out } = await run(['add', '@acme', URL_A, '--dry-run'], cwd, rt);
    expect(out).toContain('would add and trust @acme');
    expect(await readTrusted(rt.configDir)).toEqual([]);
  });

  it('trusts a URL that is already in the project when it is added again', async () => {
    const cwd = await projectWith({ registries: { '@acme': URL_A } });
    const rt = testRuntime();
    const { out } = await run(['add', '@acme', URL_A], cwd, rt);
    expect(out).toContain('except trust it');
    expect(await readTrusted(rt.configDir)).toEqual([{ namespace: '@acme', template: URL_A }]);
  });

  it('hides a token in the URL it prints, in text and in --json', async () => {
    const cwd = await projectWith();
    const url = 'https://acme.example/{name}.json?token=hunter2';
    const rt = testRuntime();
    const { out } = await run(['add', '@acme', url], cwd, rt);
    expect(out).toContain('token=***');
    expect(out).not.toContain('hunter2');
    const json = testRuntime({ configDir: rt.configDir });
    await main(['registry', 'list', '--json', '--cwd', cwd], json);
    expect(json.io.out.join('')).not.toContain('hunter2');
    expect(jsonOf(json.io.out).registries[0]?.url).toBe(
      'https://acme.example/{name}.json?token=***',
    );
    const listed = await run(['list'], cwd, testRuntime({ configDir: rt.configDir }));
    expect(listed.out).toContain('token=***');
    expect(listed.out).not.toContain('hunter2');
    expect(listed.out).toContain('[trusted]');
    expect((await loadProject(cwd)).registries).toEqual({ '@acme': url });
  });
});

describe('mfeflow registry trust and untrust', () => {
  const configured = () => projectWith({ registries: { '@acme': URL_A } });

  it('trusts a registry from the project with --yes, and lists it as trusted', async () => {
    const cwd = await configured();
    const rt = testRuntime();
    const { code, out } = await run(['trust', '@acme', '--yes'], cwd, rt);
    expect(code).toBe(0);
    expect(out).toContain('Trusted @acme');
    expect(await readTrusted(rt.configDir)).toEqual([{ namespace: '@acme', template: URL_A }]);
    const listed = await run(['list'], cwd, testRuntime({ configDir: rt.configDir }));
    expect(listed.out).toContain('[trusted]');
  });

  it('asks a person first, and trusts nothing when they say no', async () => {
    const cwd = await configured();
    const no = testRuntime({ prompter: scriptedPrompter([false]) });
    no.io.interactive = true;
    expect((await run(['trust', '@acme'], cwd, no)).code).toBe(130);
    expect(await readTrusted(no.configDir)).toEqual([]);
    const prompter = scriptedPrompter([true]);
    const yes = testRuntime({ prompter });
    yes.io.interactive = true;
    expect((await run(['trust', '@acme'], cwd, yes)).code).toBe(0);
    expect(prompter.asked.join()).toContain('Trust @acme');
    expect(await readTrusted(yes.configDir)).toHaveLength(1);
  });

  it('never trusts silently: without a terminal it needs --yes', async () => {
    const cwd = await configured();
    const rt = testRuntime();
    const { code, err } = await run(['trust', '@acme'], cwd, rt);
    expect(code).toBe(2);
    expect(err).toContain('--yes');
    expect(err).toContain('MFEFLOW_TRUST_REGISTRIES');
    expect(await readTrusted(rt.configDir)).toEqual([]);
  });

  it('writes nothing with --dry-run', async () => {
    const cwd = await configured();
    const rt = testRuntime();
    expect((await run(['trust', '@acme', '--dry-run'], cwd, rt)).out).toContain('would trust');
    expect(await readTrusted(rt.configDir)).toEqual([]);
  });

  it('is a no-op for a registry that is already trusted', async () => {
    const cwd = await configured();
    const rt = testRuntime();
    await run(['trust', '@acme', '--yes'], cwd, rt);
    const again = await run(['trust', '@acme', '--yes'], cwd, rt);
    expect(again.out).toContain('already trusted');
  });

  it('refuses a namespace the project does not have', async () => {
    const { code, err } = await run(['trust', '@nope', '--yes'], await configured());
    expect(code).toBe(2);
    expect(err).toContain('not in this project');
  });

  it('untrust forgets it, and says so when there was nothing to forget', async () => {
    const cwd = await configured();
    const rt = testRuntime();
    await run(['trust', '@acme', '--yes'], cwd, rt);
    const gone = await run(['untrust', '@acme'], cwd, rt);
    expect(gone.code).toBe(0);
    expect(gone.out).toContain('No longer trusting @acme');
    expect(await readTrusted(rt.configDir)).toEqual([]);
    expect((await run(['untrust', '@acme'], cwd, rt)).out).toContain('was not trusted');
  });

  it('untrust works outside a project and reports the trust state in --json', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const rt = testRuntime();
    await addTrusted(rt.configDir, { namespace: '@acme', template: URL_A });
    await main(['registry', 'untrust', '@acme', '--json', '--cwd', dir], rt);
    expect(jsonOf(rt.io.out)).toMatchObject({ action: 'untrust', changed: true, root: null });
    expect(await readTrusted(rt.configDir)).toEqual([]);
  });

  it('shows a trust that is only given by MFEFLOW_TRUST_REGISTRIES as trusted, without writing it', async () => {
    const cwd = await configured();
    const rt = testRuntime({ trust: ['@acme'] });
    expect((await run(['list'], cwd, rt)).out).toContain('[trusted]');
    expect(await readTrusted(rt.configDir)).toEqual([]);
  });
});

describe('mfeflow registry (usage)', () => {
  it('needs a known action', async () => {
    const cwd = await projectWith();
    expect((await run([], cwd)).err).toContain('needs an action');
    const unknown = await run(['push'], cwd);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown action "push"');
    expect((await run(['list', 'x'], cwd)).err).toContain('unexpected "x"');
    expect((await run(['list', '--nope'], cwd)).err).toContain('unknown flag');
  });
});

describe('mfeflow registry build', () => {
  const feature = {
    name: '@test/hello',
    version: '1.0.0',
    description: 'Says hello',
    files: [{ to: 'src/hello.ts', content: 'export const hello = 1;\n' }],
  };

  async function registryFolder(value: unknown = feature): Promise<string> {
    const dir = await tempDir();
    dirs.push(dir);
    await fs.mkdir(path.join(dir, 'hello'));
    await fs.writeFile(path.join(dir, 'hello', 'feature.json'), JSON.stringify(value));
    return dir;
  }

  it('writes index.json and the per-feature files under <dir>/dist, and tells how to host them', async () => {
    const dir = await registryFolder();
    const { code, out } = await run(['build', dir], dir);
    expect(code).toBe(0);
    expect(out).toContain('Built 1 feature(s) for @test');
    expect(out).toContain('mfeflow registry add @test https://<your-host>/{name}.json');
    const written = (await fs.readdir(path.join(dir, 'dist'), { recursive: true }))
      .map((f) => f.replaceAll(path.sep, '/'))
      .toSorted();
    expect(written).toEqual([
      'hello',
      'hello.json',
      'hello/1.0.0.json',
      'hello/latest.json',
      'index.json',
    ]);
    const index: unknown = JSON.parse(await fs.readFile(path.join(dir, 'dist/index.json'), 'utf8'));
    expect(index).toMatchObject({ items: [{ name: 'hello', version: '1.0.0' }] });
  });

  it('builds again over an earlier build, and writes to --out', async () => {
    const dir = await registryFolder();
    await run(['build', dir], dir);
    expect((await run(['build', dir], dir)).code).toBe(0);
    const out = path.join(dir, 'site');
    const rt = testRuntime();
    await main(['registry', 'build', dir, '--out', out, '--json', '--cwd', dir], rt);
    const result = jsonOf(rt.io.out);
    expect(result).toMatchObject({ action: 'build', root: null, changed: false });
    expect(result.build).toMatchObject({ namespace: '@test', out });
    expect(result.build?.files).toContain('index.json');
    expect((await fs.readdir(out)).toSorted()).toEqual(['hello', 'hello.json', 'index.json']);
  });

  it('writes nothing with --dry-run', async () => {
    const dir = await registryFolder();
    const { out } = await run(['build', dir, '--dry-run'], dir);
    expect(out).toContain('Dry run: would build 1 feature(s)');
    await expect(fs.access(path.join(dir, 'dist'))).rejects.toThrow();
  });

  it('explains the rule a feature broke and writes nothing', async () => {
    const dir = await registryFolder({ ...feature, files: [{ to: '.npmrc', content: 'x' }] });
    const { code, err } = await run(['build', dir], dir);
    expect(code).toBe(6);
    expect(err).toContain('MFEFLOW_E404');
    expect(err).toContain('hello/feature.json');
    expect(err).toContain('outside src/, public/ and docs/');
    await expect(fs.access(path.join(dir, 'dist'))).rejects.toThrow();
  });

  it('needs a folder', async () => {
    const dir = await registryFolder();
    expect((await run(['build'], dir)).err).toContain('needs the folder');
    expect((await run(['build', path.join(dir, 'nope')], dir)).err).toContain('is not a folder');
  });
});
