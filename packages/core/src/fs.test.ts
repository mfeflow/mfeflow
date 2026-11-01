import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realFs, symlinkedPrefix, type FsOps } from './fs';
import { rejection } from './testing';

const linked = (...links: string[]): FsOps => ({
  ...realFs,
  isSymlink: (file) => Promise.resolve(links.some((link) => file.endsWith(link))),
});

describe('symlinkedPrefix', () => {
  const root = path.join(os.tmpdir(), 'mfeflow-prefix-root');

  it('is undefined when no part of the path is a link', async () => {
    expect(await symlinkedPrefix(linked(), root, 'a/b/c.ts')).toBeUndefined();
  });

  it('names the file itself when only the file is a link', async () => {
    expect(await symlinkedPrefix(linked(path.join('a', 'b', 'c.ts')), root, 'a/b/c.ts')).toBe(
      'a/b/c.ts',
    );
  });

  it('names the outermost link when a folder on the way is one', async () => {
    const ops = linked(path.join('a', 'b'), path.join('a', 'b', 'c.ts'));
    expect(await symlinkedPrefix(ops, root, 'a/b/c.ts')).toBe('a/b');
  });

  it('does not look at the root itself', async () => {
    const asked: string[] = [];
    const ops: FsOps = {
      ...realFs,
      isSymlink: (file) => {
        asked.push(file);
        return Promise.resolve(false);
      },
    };
    await symlinkedPrefix(ops, root, 'a.ts');
    expect(asked).toEqual([path.join(root, 'a.ts')]);
  });

  it('refuses a path that leaves the root', async () => {
    const error = await rejection(symlinkedPrefix(linked(), root, '../x'));
    expect(error.code).toBe('MFEFLOW_E105');
  });

  describe('on disk', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-prefix-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('finds a symlinked folder above a file that does not exist yet', async (ctx) => {
      await fs.mkdir(path.join(dir, 'real'));
      try {
        await fs.symlink(path.join(dir, 'real'), path.join(dir, 'alias'));
      } catch {
        ctx.skip();
      }
      expect(await symlinkedPrefix(realFs, dir, 'alias/new/file.ts')).toBe('alias');
      expect(await symlinkedPrefix(realFs, dir, 'real/new/file.ts')).toBeUndefined();
    });
  });
});
