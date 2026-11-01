import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_FILE, LEGACY_APP_FILE, legacyAppFileNotice, readAppFile } from './app-file';
import { realFs, type FsOps } from './fs';
import { isMfeflowError } from './errors';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-app-file-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = (name: string, text: string) => fs.writeFile(path.join(dir, name), text);

describe('readAppFile', () => {
  it('reads mfeflow.app.json', async () => {
    await write(APP_FILE, '{"name":"cart"}');
    expect(await readAppFile(dir)).toEqual({
      name: 'mfeflow.app.json',
      text: '{"name":"cart"}',
      legacy: false,
    });
  });

  it('falls back to the old mfe.json and says so', async () => {
    await write(LEGACY_APP_FILE, '{"name":"cart"}');
    expect(await readAppFile(dir)).toEqual({
      name: 'mfe.json',
      text: '{"name":"cart"}',
      legacy: true,
    });
  });

  it('returns undefined when the app has neither', async () => {
    expect(await readAppFile(dir)).toBeUndefined();
  });

  it('throws E122 when the app has both', async () => {
    await write(APP_FILE, '{}');
    await write(LEGACY_APP_FILE, '{}');
    const error: unknown = await readAppFile(dir).catch((e: unknown) => e);
    expect(isMfeflowError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'MFEFLOW_E122' });
    expect((error as Error).message).toContain(`${dir} has both mfeflow.app.json and mfe.json`);
  });

  it('reads through the file system it is given', async () => {
    const ops: FsOps = {
      ...realFs,
      readFile: (file) =>
        path.basename(file) === LEGACY_APP_FILE
          ? Promise.resolve('{}')
          : Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })),
    };
    expect(await readAppFile('/nowhere', ops)).toMatchObject({ legacy: true });
  });
});

describe('legacyAppFileNotice', () => {
  it('is one line that names every old file', () => {
    const notice = legacyAppFileNotice(['apps/cart', 'apps/shell']);
    expect(notice).toBe(
      'Notice: mfe.json is now mfeflow.app.json. Rename apps/cart/mfe.json, apps/shell/mfe.json; the old name still works for now.',
    );
    expect(notice).not.toContain('\n');
  });
});
