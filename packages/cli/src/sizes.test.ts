import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kb, remoteSizes } from './sizes';
import { removeDir, tempDir } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function dist(files: Record<string, number>, manifest: unknown): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  for (const [file, bytes] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), randomBytes(bytes));
  }
  await fs.writeFile(path.join(dir, 'mf-manifest.json'), JSON.stringify(manifest));
  return dir;
}

describe('kb', () => {
  it('is one decimal of 1024 bytes', () => {
    expect(kb(1536)).toBe(1.5);
    expect(kb(0)).toBe(0);
  });
});

describe('remoteSizes', () => {
  const files = {
    'static/js/entry.js': 2048,
    'static/js/App.js': 1024,
    'static/css/App.css': 4096,
  };

  it('sizes the entry and the JS (not the CSS) each expose loads', async () => {
    const dir = await dist(files, {
      metaData: { remoteEntry: { name: 'entry.js', path: 'static/js' } },
      exposes: [
        {
          path: './App',
          assets: { js: { sync: ['static/js/App.js'] }, css: { sync: ['static/css/App.css'] } },
        },
      ],
    });
    const size = await remoteSizes(dir);
    expect(size?.entryBytes).toBeGreaterThan(2048);
    expect(Object.keys(size?.exposes ?? {})).toEqual(['./App']);
    expect(size?.exposes['./App']).toBeLessThan(1200);
  });

  it('joins the entry path as Module Federation does, and reads files from disk whatever the publicPath', async () => {
    const dir = await dist(files, {
      metaData: {
        publicPath: 'https://cdn.example.com/assets/',
        globalName: 'not a valid name',
        remoteEntry: { name: 'entry.js', path: './static/js/', type: 'something-new' },
      },
      exposes: [],
    });
    expect((await remoteSizes(dir))?.entryBytes).toBeGreaterThan(2048);
  });

  it('is undefined for a manifest with no entry, a missing entry file, or no manifest', async () => {
    expect(await remoteSizes(await dist(files, { metaData: { remoteEntry: {} } }))).toBeUndefined();
    expect(
      await remoteSizes(
        await dist(files, { metaData: { remoteEntry: { name: 'gone.js', path: '' } } }),
      ),
    ).toBeUndefined();
    const empty = await tempDir();
    dirs.push(empty);
    expect(await remoteSizes(empty)).toBeUndefined();
  });

  it('does not read outside dist for a path that climbs out of it', async () => {
    const dir = await dist(files, {
      metaData: { remoteEntry: { name: '../../../etc/hosts', path: '' } },
    });
    expect(await remoteSizes(dir)).toBeUndefined();
  });
});
