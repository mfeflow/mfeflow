import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rejection } from '../testing';
import { buildRegistry } from './registry-build';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-build-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const feature = (extra: object = {}) => ({
  name: '@test/hello',
  version: '1.0.0',
  description: 'Says hello',
  files: [{ to: 'src/hello.ts', content: 'export const hello = 1;\n' }],
  ...extra,
});

async function put(folder: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(dir, folder), { recursive: true });
  await fs.writeFile(
    path.join(dir, folder, 'feature.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

const messageOf = async (): Promise<string> => (await rejection(buildRegistry(dir))).message;

describe('buildRegistry', () => {
  it('lists every feature in the index and writes the three files each is served from', async () => {
    await put('hello', feature({ keywords: ['greeting'] }));
    await put('bye', feature({ name: '@test/bye', version: '2.1.0-beta.1', description: 'Waves' }));
    const built = await buildRegistry(dir);
    expect(built.namespace).toBe('@test');
    expect(built.index.items).toEqual([
      { name: 'bye', version: '2.1.0-beta.1', description: 'Waves' },
      { name: 'hello', version: '1.0.0', description: 'Says hello', keywords: ['greeting'] },
    ]);
    expect(built.features).toEqual([
      {
        name: '@test/bye',
        version: '2.1.0-beta.1',
        files: ['bye.json', 'bye/2.1.0-beta.1.json', 'bye/latest.json'],
      },
      {
        name: '@test/hello',
        version: '1.0.0',
        files: ['hello.json', 'hello/1.0.0.json', 'hello/latest.json'],
      },
    ]);
    expect(built.files.map((f) => f.path).toSorted()).toEqual([
      'bye.json',
      'bye/2.1.0-beta.1.json',
      'bye/latest.json',
      'hello.json',
      'hello/1.0.0.json',
      'hello/latest.json',
      'index.json',
    ]);
    const latest = built.files.find((f) => f.path === 'hello/latest.json');
    expect(JSON.parse(latest?.content ?? '{}')).toMatchObject({ name: '@test/hello' });
    expect(latest?.content).toBe(built.files.find((f) => f.path === 'hello.json')?.content);
  });

  it('gives the same bytes every time', async () => {
    await put('hello', feature());
    expect(await buildRegistry(dir)).toEqual(await buildRegistry(dir));
  });

  it('ignores folders without a feature.json and files beside the folders', async () => {
    await put('hello', feature());
    await fs.mkdir(path.join(dir, 'notes'));
    await fs.writeFile(path.join(dir, 'README.md'), '# hi');
    expect((await buildRegistry(dir)).features).toHaveLength(1);
  });

  it('names the rule a feature broke, as the loader does', async () => {
    await put('hello', feature({ files: [{ to: 'package.json', content: '{}' }] }));
    const message = await messageOf();
    expect(message).toContain('- hello/feature.json: A third-party feature');
    expect(message).toContain('package.json');
    expect(message).toContain('outside src/');
  });

  it('refuses what only first-party features may do', async () => {
    await put('hello', feature({ hooks: { postinstall: 'x' } }));
    expect(await messageOf()).toContain('"hooks" is not allowed');
    await put('hello', feature({ scripts: [{ name: 'install', command: 'x' }] }));
    expect(await messageOf()).toContain('npm lifecycle');
    await put('hello', feature({ transforms: [{ op: 'run-shell', file: 'src/a.ts' }] }));
    expect(await messageOf()).toContain('run-shell');
    await put('hello', feature({ name: '@mfeflow/hello' }));
    expect(await messageOf()).toContain('cannot use @mfeflow');
    await put('hello', feature({ dependencies: [{ name: 'x', range: 'file:../x' }] }));
    expect(await messageOf()).toContain('not a registry version range');
  });

  it('reports every problem at once, with the count', async () => {
    await put('one', feature({ files: [{ to: '.npmrc', content: 'x' }] }));
    await put('two', feature({ name: '@test/two', scripts: [{ name: 'install', command: 'x' }] }));
    await put('three', '{');
    const message = await messageOf();
    expect(message).toContain('3 problem(s)');
    for (const folder of ['one', 'two', 'three'])
      expect(message).toContain(`- ${folder}/feature.json: `);
    expect(message.match(/two\/feature\.json/g)).toHaveLength(1);
  });

  it('needs a semver version and a description, and keeps "index" free', async () => {
    await put('a', feature({ name: '@test/a', version: 'latest' }));
    await put('c', feature({ name: '@test/c', version: 'v1.0.0' }));
    await put('b', feature({ name: '@test/b', description: undefined }));
    await put('index', feature({ name: '@test/index' }));
    const message = await messageOf();
    expect(message).toContain('must be a semver version');
    expect(message).toContain('description is required');
    expect(message).toContain('"index" is taken');
  });

  it('serves one namespace and one feature per name', async () => {
    await put('a', feature({ name: '@one/a' }));
    await put('b', feature({ name: '@two/b' }));
    expect(await messageOf()).toContain('one registry serves one namespace');
    await put('b', feature({ name: '@one/a' }));
    expect(await messageOf()).toContain('a is already defined by a/feature.json');
  });

  it('refuses a namespace `mfeflow registry add` would refuse', async () => {
    await put('a', feature({ name: '@-x/a' }));
    expect(await messageOf()).toContain('namespace "@-x" must start with a letter or digit');
  });

  it('refuses a feature the loader would refuse for size', async () => {
    await put(
      'big',
      feature({ name: '@test/big', files: [{ to: 'src/big.ts', content: 'x'.repeat(1_000_001) }] }),
    );
    expect(await messageOf()).toContain('larger than 1 MB');
  });

  it('fails when the folder is missing or holds no feature', async () => {
    const missing = await rejection(buildRegistry(path.join(dir, 'nope')));
    expect(missing.code).toBe('MFEFLOW_E404');
    expect(missing.message).toContain('is not a folder');
    const empty = await rejection(buildRegistry(dir));
    expect(empty.message).toContain('no <folder>/feature.json');
    expect(empty.fix).toContain('hello/feature.json');
  });

  it('lets an unexpected error through', async () => {
    await put('hello', feature());
    const ops = {
      listDirs: () => Promise.resolve(['hello']),
      readFile: () => Promise.reject(Object.assign(new Error('disk'), { code: 'EIO' })),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only two calls are used
    const error = await rejection(buildRegistry(dir, ops as never));
    expect(error.code).toBe('MFEFLOW_E106');
  });
});
