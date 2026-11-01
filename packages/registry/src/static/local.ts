import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertSafeKey,
  HostError,
  PreconditionFailedError,
  toBytes,
  type ObjectInfo,
  type PutOptions,
  type RegistryHost,
  type StoredObject,
} from './host';

const sha256Of = (body: Uint8Array): string =>
  crypto.createHash('sha256').update(body).digest('hex');
const etagOf = (body: Uint8Array): string => `"${sha256Of(body)}"`;

const inside = (real: string, base: string): boolean =>
  real === base || real.startsWith(base + path.sep);

const hasCode = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error && 'code' in error && codes.includes(String(error.code));

async function readOrUndefined(file: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (hasCode(error, 'ENOENT', 'ENOTDIR')) return undefined;
    throw error;
  }
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT', 'ENOTDIR')) return;
    throw error;
  }
  for (const entry of entries) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- depth-first walk
      await walk(dir, next, out);
    } else out.push(next);
  }
}

/** The real path of the nearest ancestor of `target` that exists. */
async function realAncestor(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- walks up to the first folder that exists
      return await fs.realpath(current);
    } catch (error) {
      const parent = path.dirname(current);
      if (!hasCode(error, 'ENOENT', 'ENOTDIR') || parent === current) throw error;
      current = parent;
    }
  }
}

async function write(file: string, bytes: Uint8Array, createOnly: boolean): Promise<boolean> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, bytes);
    if (createOnly) {
      try {
        await fs.link(temp, file);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) return false;
        throw error;
      }
    } else await fs.rename(temp, file);
    return true;
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/**
 * A registry in a folder, for local runs and for a Pages-style workflow that publishes the folder.
 * ETags are SHA-256 of the content. Writes go to a temp file in the same folder and are renamed into
 * place, so a crash never leaves half a file. A symlink that points out of the folder is refused.
 */
export function localHost(dir: string): RegistryHost {
  const root = path.resolve(dir);

  async function fileOf(key: string): Promise<string> {
    assertSafeKey(key);
    const file = path.join(root, ...key.split('/'));
    if (!inside(file, root)) throw new HostError(`key "${key}" is outside ${root}`);
    const [realRoot, realParent] = await Promise.all([
      realAncestor(root),
      realAncestor(path.dirname(file)),
    ]);
    if (!inside(realParent, realRoot)) throw new HostError(`key "${key}" resolves outside ${root}`);
    try {
      if ((await fs.lstat(file)).isSymbolicLink())
        throw new HostError(`key "${key}" is a symlink; refusing to follow it`);
    } catch (error) {
      if (!hasCode(error, 'ENOENT', 'ENOTDIR')) throw error;
    }
    return file;
  }

  return {
    async put(key, body, options: PutOptions) {
      const file = await fileOf(key);
      const bytes = toBytes(body);
      if (options.ifMatch === undefined) {
        if (!(await write(file, bytes, options.ifNoneMatch === '*')))
          throw new PreconditionFailedError(key);
        return { etag: etagOf(bytes) };
      }
      // Check and write under a lock file, so two writers holding the same ETag cannot both win.
      const lock = `${file}.lock`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      let handle;
      try {
        handle = await fs.open(lock, 'wx');
      } catch (error) {
        if (hasCode(error, 'EEXIST')) throw new PreconditionFailedError(key);
        throw error;
      }
      try {
        const current = await readOrUndefined(file);
        if (current === undefined || etagOf(current) !== options.ifMatch)
          throw new PreconditionFailedError(key);
        await write(file, bytes, false);
        return { etag: etagOf(bytes) };
      } finally {
        await handle.close();
        await fs.rm(lock, { force: true });
      }
    },
    async get(key): Promise<StoredObject | undefined> {
      const body = await readOrUndefined(await fileOf(key));
      return body === undefined ? undefined : { body, etag: etagOf(body) };
    },
    async head(key): Promise<ObjectInfo | undefined> {
      const body = await readOrUndefined(await fileOf(key));
      return body === undefined
        ? undefined
        : { etag: etagOf(body), size: body.length, sha256: sha256Of(body) };
    },
    async list(prefix) {
      const all: string[] = [];
      await walk(root, '', all);
      return all
        .filter((key) => key.startsWith(prefix) && !key.endsWith('.tmp') && !key.endsWith('.lock'))
        .toSorted();
    },
  };
}
