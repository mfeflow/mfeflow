import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashContent,
  integrityOf,
  parseProject,
  serializeProject,
  type FetchLike,
} from '@mfeflow/core';
import { main, validateResult, type UpgradeResult } from '..';
import { EXIT } from '../exit';
import {
  fakeSystem,
  readTree,
  removeDir,
  scriptedPrompter,
  tempDir,
  testRuntime,
} from '../testing';
import { readPackageJson } from '../version';
import fixture from '../../test-fixtures/project-0.1.0.json';

const HOME = 'apps/shell/src/pages/Home.tsx';
const running = readPackageJson().version;

/** Whether this machine lets a test create a symlink (Windows without developer mode does not). */
const canSymlink = (() => {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-can-link-'));
  try {
    fsSync.symlinkSync(dir, path.join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fsSync.rmSync(dir, { recursive: true, force: true });
  }
})();

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** The 0.1.0 project in a temp folder with `edits` written over it. No git, no child process. */
async function oldProject(edits: Record<string, string> = {}): Promise<string> {
  const root = await tempDir('mfeflow-upgrade-cmd-');
  dirs.push(root);
  for (const [file, content] of Object.entries({ ...fixture.files, ...edits })) {
    const target = path.join(root, ...file.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

const upgrade = (root: string, args: string[], rt = testRuntime()) =>
  main(['upgrade', ...args, '--cwd', root], rt).then((code) => ({ code, rt }));

const json = (rt: { io: { out: string[] } }) => JSON.parse(rt.io.out.join('')) as UpgradeResult;

/** An env.ts the way `add env-key` leaves it: a key added, and the recorded hash moved with it. */
async function withEnvKey(): Promise<string> {
  const added = fixture.files['env.ts'].replace(
    '  server: {\n',
    '  server: {\n    MY_KEY: z.string(),\n',
  );
  const project = parseProject(fixture.files['mfeflow.json']);
  project.files = { ...project.files, 'env.ts': hashContent(added) };
  return oldProject({ 'env.ts': added, 'mfeflow.json': serializeProject(project) });
}

describe('mfeflow upgrade on the 0.1.0 fixture', () => {
  it('upgrades a project with no edits on its own, installs once, and a second run finds nothing', async () => {
    const root = await oldProject();
    const { code, rt } = await upgrade(root, ['--yes']);
    expect(code).toBe(EXIT.ok);
    expect(rt.system.installs).toHaveLength(1);
    const saved = parseProject((await readTree(root))['mfeflow.json'] ?? '');
    expect(saved.cli).toBe(running);
    const text = rt.io.out.join('\n');
    expect(text).toContain(`Upgrading 0.1.0 to ${running}`);
    expect(text).toContain('Edited in place:');
    expect(text).toContain('@mfeflow ranges moved');

    const again = await upgrade(root, ['--json']);
    expect(again.code).toBe(EXIT.ok);
    expect(json(again.rt)).toMatchObject({ upToDate: true, diverged: [], written: [] });
    expect(again.rt.system.installs).toEqual([]);
  });

  it('replaces the env files when they hold no key of yours', async () => {
    const root = await oldProject();
    await upgrade(root, ['--yes']);
    expect(json((await upgrade(root, ['--json', '--dry-run'])).rt).diverged).toEqual([]);
  });

  it('stops before writing when you edited a file and said nothing about it', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const before = await readTree(root);
    const { code, rt } = await upgrade(root, ['--yes']);
    expect(code).toBe(8);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E604');
    expect(rt.io.err.join('\n')).toContain(HOME);
    expect(await readTree(root)).toEqual(before);
    expect(rt.system.installs).toEqual([]);
  });

  it('fails with E604 as JSON and the same exit code', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const { code, rt } = await upgrade(root, ['--json']);
    expect(code).toBe(8);
    const failure = JSON.parse(rt.io.out.join('')) as { error: { code: string }; exitCode: number };
    expect(failure.error.code).toBe('MFEFLOW_E604');
    expect(failure.exitCode).toBe(8);
    expect(validateResult(failure)).toEqual([]);
  });

  it('keeps your file with --keep, and it stops coming back on the next runs', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const first = await upgrade(root, ['--yes', '--keep', HOME]);
    expect(first.code).toBe(EXIT.ok);
    const tree = await readTree(root);
    expect(tree[HOME]).toBe('my own home page\n');
    expect(parseProject(tree['mfeflow.json'] ?? '').kept?.[HOME]).toMatch(/^sha256-/);

    const again = await upgrade(root, ['--yes']);
    expect(again.code).toBe(EXIT.ok);
    const after = await upgrade(root, ['--json', '--dry-run']);
    const result = json(after.rt);
    expect(result.diverged).toEqual([]);
    expect(result.plan.changes.map((c) => c.path)).not.toContain(HOME);
    expect((await readTree(root))[HOME]).toBe('my own home page\n');
  });

  it('replaces your file with --accept and records the new version', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const { code } = await upgrade(root, ['--yes', '--accept', HOME]);
    expect(code).toBe(EXIT.ok);
    const tree = await readTree(root);
    expect(tree[HOME]).not.toBe('my own home page\n');
    expect(parseProject(tree['mfeflow.json'] ?? '').files?.[HOME]).toBe(
      hashContent(tree[HOME] ?? ''),
    );
    expect(json((await upgrade(root, ['--json'])).rt).upToDate).toBe(true);
  });

  it('takes a comma list, and both flags together', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n', 'docs/ci.md': 'my ci notes\n' });
    const { code } = await upgrade(root, ['--yes', '--accept', HOME, '--keep', 'docs/ci.md']);
    expect(code).toBe(EXIT.ok);
    const tree = await readTree(root);
    expect(tree['docs/ci.md']).toBe('my ci notes\n');
    expect(tree[HOME]).not.toBe('my own home page\n');
  });

  it('upgrades an untouched project in a plain non-interactive run, with no flags at all', async () => {
    const root = await oldProject();
    const { code, rt } = await upgrade(root, []);
    expect(code).toBe(EXIT.ok);
    expect(rt.system.installs).toHaveLength(1);
    expect(parseProject((await readTree(root))['mfeflow.json'] ?? '').cli).toBe(running);
  });

  it('leaves a file you edited alone when the new version generates what the old one did', async () => {
    const root = await oldProject();
    expect((await upgrade(root, ['--yes'])).code).toBe(EXIT.ok);
    expect((await upgrade(root, ['--yes', '--accept', 'all'])).code).toBe(EXIT.ok);
    const file = path.join(root, ...HOME.split('/'));
    await fs.writeFile(file, 'my own home page\n');
    const { code, rt } = await upgrade(root, ['--json']);
    expect(code).toBe(EXIT.ok);
    expect(json(rt)).toMatchObject({ upToDate: true, diverged: [] });
    expect(await fs.readFile(file, 'utf8')).toBe('my own home page\n');
  });

  it('is not up to date while a file waits for a decision, in a dry run and a real one', async () => {
    const root = await oldProject();
    expect((await upgrade(root, ['--yes'])).code).toBe(EXIT.ok);
    const project = parseProject((await readTree(root))['mfeflow.json'] ?? '');
    delete project.files?.[HOME];
    await fs.writeFile(path.join(root, 'mfeflow.json'), serializeProject(project));
    await fs.writeFile(path.join(root, ...HOME.split('/')), 'my own home page\n');
    const dry = await upgrade(root, ['--json', '--dry-run']);
    expect(dry.code).toBe(EXIT.ok);
    expect(json(dry.rt)).toMatchObject({ upToDate: false, diverged: [{ path: HOME }] });
    const real = await upgrade(root, ['--json']);
    expect(real.code).toBe(8);
  });

  it('reports a symlinked generated file without waiting for a decision, and never writes over it', async (ctx) => {
    const root = await oldProject();
    const outside = path.join(root, '..', `mfeflow-link-${path.basename(root)}.md`);
    dirs.push(outside);
    await fs.writeFile(outside, 'kept elsewhere\n');
    const link = path.join(root, 'README.md');
    await fs.rm(link);
    try {
      await fs.symlink(outside, link);
    } catch {
      ctx.skip();
    }
    for (const args of [['--yes'], ['--yes', '--accept', 'all']]) {
      // oxlint-disable-next-line no-await-in-loop -- the second run starts from the first
      const { code, rt } = await upgrade(root, [...args, '--json']);
      expect(code).toBe(EXIT.ok);
      expect(json(rt).diverged.find((d) => d.path === 'README.md')).toMatchObject({
        reason: 'symlink',
        decision: 'undecided',
      });
      // oxlint-disable-next-line no-await-in-loop -- see above
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      // oxlint-disable-next-line no-await-in-loop -- see above
      expect(await fs.readFile(outside, 'utf8')).toBe('kept elsewhere\n');
    }
  });

  it.skipIf(!canSymlink)(
    'reports a file under a symlinked folder and never writes through the link',
    async () => {
      const root = await oldProject();
      const pages = path.join(root, 'apps', 'shell', 'src', 'pages');
      const elsewhere = path.join(root, 'elsewhere');
      await fs.rename(pages, elsewhere);
      await fs.symlink(elsewhere, pages);
      await fs.writeFile(path.join(elsewhere, 'Home.tsx'), 'my own home page\n');
      const before = await readTree(elsewhere);
      for (const args of [['--yes'], ['--yes', '--accept', 'all']]) {
        // oxlint-disable-next-line no-await-in-loop -- the second run starts from the first
        const { code, rt } = await upgrade(root, [...args, '--json']);
        expect(code).toBe(EXIT.ok);
        expect(json(rt).diverged.find((d) => d.path === HOME)).toMatchObject({
          reason: 'symlink',
          decision: 'undecided',
        });
        // oxlint-disable-next-line no-await-in-loop -- see above
        expect(await readTree(elsewhere)).toEqual(before);
        // oxlint-disable-next-line no-await-in-loop -- see above
        expect((await fs.lstat(pages)).isSymbolicLink()).toBe(true);
      }
    },
  );

  it.skipIf(!canSymlink)('refuses to edit a package.json that is a symlink', async () => {
    const root = await oldProject();
    const pkg = path.join(root, 'package.json');
    await fs.rename(pkg, path.join(root, 'real-package.json'));
    await fs.symlink('real-package.json', pkg);
    const before = await readTree(root);
    const { code, rt } = await upgrade(root, ['--yes']);
    expect(code).not.toBe(EXIT.ok);
    expect(rt.io.err.join('\n')).toContain('symlink');
    expect(await readTree(root)).toEqual(before);
  });

  it('names the keys you would lose in an env file the CLI added to, and keeps them with --keep', async () => {
    const root = await withEnvKey();
    const dry = await upgrade(root, ['--json', '--dry-run']);
    const env = json(dry.rt).diverged.find((d) => d.path === 'env.ts');
    expect(env).toMatchObject({
      reason: 'edited-by-cli',
      decision: 'undecided',
      lostKeys: ['MY_KEY'],
    });

    expect((await upgrade(root, ['--yes'])).code).toBe(8);
    expect((await upgrade(root, ['--yes', '--keep', 'env.ts'])).code).toBe(EXIT.ok);
    expect((await readTree(root))['env.ts']).toContain('MY_KEY');
    expect((await upgrade(root, ['--yes'])).code).toBe(EXIT.ok);
    expect((await readTree(root))['env.ts']).toContain('MY_KEY');
  });

  it('drops the keys when you accept an env file, and says so', async () => {
    const root = await withEnvKey();
    const { code, rt } = await upgrade(root, ['--yes', '--accept', 'env.ts']);
    expect(code).toBe(EXIT.ok);
    expect(rt.io.out.join('\n')).toContain('add env-key');
    expect((await readTree(root))['env.ts']).not.toContain('MY_KEY');
  });

  it('writes nothing on a dry run, prints every diff, and installs nothing', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const before = await readTree(root);
    const { code, rt } = await upgrade(root, ['--dry-run']);
    expect(code).toBe(EXIT.ok);
    expect(await readTree(root)).toEqual(before);
    const text = rt.io.out.join('\n');
    expect(text).toContain('diff --mfeflow package.json');
    expect(text).toContain('-my own home page');
    expect(text).toContain('Dry run: nothing was written.');
    expect(rt.system.installs).toEqual([]);
  });

  it('prints one JSON document that matches the output schema', async () => {
    for (const args of [
      ['--json', '--dry-run'],
      ['--json', '--keep', HOME],
      ['--json', '--accept', 'all'],
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- each run needs its own fresh project
      const root = await oldProject({ [HOME]: 'my own home page\n' });
      // oxlint-disable-next-line no-await-in-loop -- see above
      const { code, rt } = await upgrade(root, args);
      expect(code).toBe(EXIT.ok);
      const result = json(rt);
      expect(validateResult(result)).toEqual([]);
      expect(result).toMatchObject({ command: 'upgrade', from: '0.1.0', to: running });
      expect(rt.io.out).toHaveLength(1);
      if (args.includes('--dry-run')) {
        expect(result.diverged[0]).toMatchObject({ path: HOME, reason: 'edited' });
        expect(result.diverged[0]?.diff).toContain('-my own home page');
      }
    }
  });

  it('rejects a document that breaks the schema', () => {
    expect(
      validateResult({ ok: true, command: 'upgrade', diverged: [{ decision: 'maybe' }] }),
    ).not.toEqual([]);
  });

  it('puts every file back when the install fails', async () => {
    const root = await oldProject();
    const before = await readTree(root);
    const rt = Object.assign(testRuntime(), {
      system: fakeSystem({ installError: new Error('network down') }),
    });
    const { code } = await upgrade(root, ['--yes'], rt);
    expect(code).toBe(EXIT.feature);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E213');
    expect(rt.system.installs).toHaveLength(1);
    expect(await readTree(root)).toEqual(before);
  });

  it('skips the install with --no-install', async () => {
    const root = await oldProject();
    const { code, rt } = await upgrade(root, ['--yes', '--no-install']);
    expect(code).toBe(EXIT.ok);
    expect(rt.system.installs).toEqual([]);
  });

  it('asks once in a terminal, leaves undecided files alone, and writes nothing on no', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const before = await readTree(root);
    const declined = testRuntime({ prompter: scriptedPrompter([false]) });
    declined.io.interactive = true;
    expect((await upgrade(root, [], declined)).code).toBe(EXIT.cancelled);
    expect(await readTree(root)).toEqual(before);

    const agreed = testRuntime({ prompter: scriptedPrompter([true]) });
    agreed.io.interactive = true;
    const { code, rt } = await upgrade(root, [], agreed);
    expect(code).toBe(EXIT.ok);
    expect(agreed.prompter).toHaveProperty('asked', ['Write these changes?']);
    expect(rt.io.out.join('\n')).toContain('needs a decision');
    expect((await readTree(root))[HOME]).toBe('my own home page\n');
  });
});

describe('mfeflow upgrade arguments and errors', () => {
  it('refuses a --to that is not this version, and points at the right command', async () => {
    const root = await oldProject();
    const { code, rt } = await upgrade(root, ['--to', '0.0.1']);
    expect(code).toBe(EXIT.usage);
    expect(rt.io.err.join('\n')).toContain('pnpm dlx mfeflow@0.0.1 upgrade');
    expect((await upgrade(root, ['--to', running, '--dry-run'])).code).toBe(EXIT.ok);
  });

  it('rejects a path that is not a file needing a decision, and a path in both lists', async () => {
    const root = await oldProject({ [HOME]: 'my own home page\n' });
    const unknown = await upgrade(root, ['--accept', 'nope.ts']);
    expect(unknown.code).toBe(EXIT.usage);
    expect(unknown.rt.io.err.join('\n')).toContain(HOME);
    expect((await upgrade(root, ['--accept', HOME, '--keep', HOME])).code).toBe(EXIT.usage);
    expect((await upgrade(root, ['--accept', 'all', '--keep', 'all'])).code).toBe(EXIT.usage);
  });

  it('exits 8 for a project newer than this version, and for one it cannot date', async () => {
    const root = await oldProject();
    const project = parseProject(fixture.files['mfeflow.json']);
    await fs.writeFile(
      path.join(root, 'mfeflow.json'),
      serializeProject({ ...project, cli: '99.0.0' }),
    );
    const newer = await upgrade(root, ['--yes']);
    expect(newer.code).toBe(8);
    expect(newer.rt.io.err.join('\n')).toContain('MFEFLOW_E602');

    await fs.writeFile(
      path.join(root, 'apps/shell/package.json'),
      JSON.stringify({ name: '@shopco/shell' }),
    );
    expect((await upgrade(root, ['--yes'])).code).toBe(8);
  });

  it('reports a project already at this version as up to date, without writing', async () => {
    const root = await tempDir('mfeflow-upgrade-fresh-');
    dirs.push(root);
    expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', root], testRuntime())).toBe(
      0,
    );
    const project = path.join(root, 'app');
    const before = await readTree(project);
    const { code, rt } = await upgrade(project, ['--yes']);
    expect(code).toBe(EXIT.ok);
    expect(rt.io.out.join('\n')).toContain('already at');
    expect(await readTree(project)).toEqual(before);
  });
});

describe('mfeflow upgrade with a registry feature', () => {
  const manifest = {
    name: '@acme/hello',
    version: '1.0.0',
    files: [{ to: 'src/hello.ts', target: 'shell', content: 'export const hello = 1;\n' }],
  };
  const serving =
    (body: object): FetchLike =>
    (url) =>
      Promise.resolve({
        ok: !url.endsWith('/index.json'),
        status: url.endsWith('/index.json') ? 404 : 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      });

  /** The fixture with `@acme/hello` installed at 1.0.0, hashed as served. */
  async function withRegistryFeature(): Promise<string> {
    const project = parseProject(fixture.files['mfeflow.json']);
    project.registries = { '@acme': 'https://acme.dev/{name}.json' };
    project.features['@acme/hello'] = {
      version: '1.0.0',
      integrity: integrityOf(JSON.stringify(manifest)),
    };
    return oldProject({ 'mfeflow.json': serializeProject(project) });
  }

  it('will not apply it without --yes when nobody can confirm, and writes nothing', async () => {
    const root = await withRegistryFeature();
    const before = await readTree(root);
    const rt = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    const { code } = await upgrade(root, [], rt);
    expect(code).toBe(EXIT.usage);
    expect(rt.io.err.join('\n')).toContain('--yes');
    expect(await readTree(root)).toEqual(before);
  });

  it('applies it with --yes, and a dry run needs no --yes', async () => {
    const root = await withRegistryFeature();
    const dry = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    expect((await upgrade(root, ['--dry-run'], dry)).code).toBe(EXIT.ok);
    const rt = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    expect((await upgrade(root, ['--yes'], rt)).code).toBe(EXIT.ok);
    expect((await readTree(root))['apps/shell/src/hello.ts']).toBe('export const hello = 1;\n');
  });

  it('stops with E406 when the registry serves other bytes for the same version', async () => {
    const root = await withRegistryFeature();
    const before = await readTree(root);
    const changed = { ...manifest, files: [{ ...manifest.files[0], content: 'evil();\n' }] };
    const rt = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
    const { code } = await upgrade(root, ['--yes'], rt);
    expect(code).toBe(6);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E406');
    expect(await readTree(root)).toEqual(before);

    const accepted = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
    expect((await upgrade(root, ['--yes', '--accept-changed-content'], accepted)).code).toBe(0);
    expect(
      parseProject((await readTree(root))['mfeflow.json'] ?? '').features['@acme/hello'],
    ).toMatchObject({
      integrity: integrityOf(JSON.stringify(changed)),
    });
  });

  it('shows a feature with no recorded hash as first-seen, then verifies it on the next run', async () => {
    const project = parseProject(fixture.files['mfeflow.json']);
    project.registries = { '@acme': 'https://acme.dev/{name}.json' };
    project.features['@acme/hello'] = { version: '1.0.0' };
    const root = await oldProject({ 'mfeflow.json': serializeProject(project) });
    const dry = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    const first = await upgrade(root, ['--dry-run', '--json'], dry);
    expect(json(first.rt).integrity).toEqual({ '@acme/hello': 'first-seen' });
    expect(validateResult(json(first.rt))).toEqual([]);

    const text = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    await upgrade(root, ['--dry-run'], text);
    expect(text.io.out.join('\n')).toContain('Registry feature @acme/hello: no hash was recorded');

    const rt = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
    expect((await upgrade(root, ['--yes'], rt)).code).toBe(EXIT.ok);
    const again = await upgrade(
      root,
      ['--json'],
      testRuntime({ trust: ['@acme'], fetch: serving(manifest) }),
    );
    expect(json(again.rt).integrity).toEqual({ '@acme/hello': 'verified' });
  });

  describe('--accept-changed-content', () => {
    const changed = { ...manifest, files: [{ ...manifest.files[0], content: 'evil();\n' }] };
    const recorded = async (root: string) =>
      parseProject((await readTree(root))['mfeflow.json'] ?? '').features['@acme/hello']?.integrity;

    it('takes only the features it names', async () => {
      const root = await withRegistryFeature();
      const other = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
      expect((await upgrade(root, ['--yes', '--accept-changed-content', 'core'], other)).code).toBe(
        6,
      );
      expect(other.io.err.join('\n')).toContain('MFEFLOW_E406');

      const named = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
      const args = ['--yes', '--accept-changed-content', '@acme/hello'];
      expect((await upgrade(root, args, named)).code).toBe(EXIT.ok);
      expect(await recorded(root)).toBe(integrityOf(JSON.stringify(changed)));
    });

    it('accepts the = form, and refuses a name that is not installed', async () => {
      const root = await withRegistryFeature();
      const rt = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
      const bad = await upgrade(root, ['--yes', '--accept-changed-content=@acme/nope'], rt);
      expect(bad.code).toBe(EXIT.usage);
      expect(rt.io.err.join('\n')).toContain('@acme/nope');
      const ok = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
      expect(
        (await upgrade(root, ['--yes', '--accept-changed-content=@acme/hello'], ok)).code,
      ).toBe(EXIT.ok);
    });

    it('refuses names that are only on the prototype, an empty list, and unknown repeats', async () => {
      const root = await withRegistryFeature();
      for (const args of [
        ['--accept-changed-content', 'constructor'],
        ['--accept-changed-content=toString'],
        ['--accept-changed-content='],
        ['--accept-changed-content', '@acme/hello', '--accept-changed-content', '@acme/nope'],
      ]) {
        const rt = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
        // oxlint-disable-next-line no-await-in-loop -- one project, nothing is written
        expect((await upgrade(root, ['--yes', ...args], rt)).code).toBe(EXIT.usage);
        expect(rt.io.err.join('\n')).toContain('MFEFLOW_E107');
      }
    });

    it('merges a repeated flag', async () => {
      const root = await withRegistryFeature();
      const rt = testRuntime({ trust: ['@acme'], fetch: serving(changed) });
      const args = [
        '--yes',
        '--accept-changed-content=core',
        '--accept-changed-content=@acme/hello',
      ];
      expect((await upgrade(root, args, rt)).code).toBe(EXIT.ok);
      expect(await recorded(root)).toBe(integrityOf(JSON.stringify(changed)));
    });

    it('saves the new hash even when nothing else needs writing, so E406 does not come back', async () => {
      const root = await withRegistryFeature();
      const served = testRuntime({ trust: ['@acme'], fetch: serving(manifest) });
      expect((await upgrade(root, ['--yes'], served)).code).toBe(EXIT.ok);
      const files = await readTree(root);

      const reworded = { ...manifest, description: 'same files, new words' };
      const accepted = testRuntime({ trust: ['@acme'], fetch: serving(reworded) });
      const { code } = await upgrade(root, ['--yes', '--accept-changed-content'], accepted);
      expect(code).toBe(EXIT.ok);
      expect(await recorded(root)).toBe(integrityOf(JSON.stringify(reworded)));
      const after = await readTree(root);
      expect(Object.keys(after).filter((file) => after[file] !== files[file])).toEqual([
        'mfeflow.json',
      ]);

      const next = testRuntime({ trust: ['@acme'], fetch: serving(reworded) });
      expect((await upgrade(root, ['--yes'], next)).code).toBe(EXIT.ok);
    });
  });

  it('does not ask a registry the user has not trusted on this machine', async () => {
    const root = await withRegistryFeature();
    const rt = testRuntime({ fetch: serving(manifest) });
    const { code } = await upgrade(root, ['--yes'], rt);
    expect(code).toBe(6);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E405');
  });
});
