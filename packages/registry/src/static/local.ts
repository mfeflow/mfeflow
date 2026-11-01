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

const NO_LINK = ['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV'];
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Create-only without `link` (some filesystems refuse it): `wx` still fails if the file exists. */
async function createExclusive(file: string, bytes: Uint8Array): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(file, 'wx');
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
  try {
    await handle.writeFile(bytes);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(file, { force: true });
    throw error;
  }
  await handle.close();
  return true;
}

async function write(
  file: string,
  bytes: Uint8Array,
  createOnly: boolean,
  link: typeof fs.link,
): Promise<boolean> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, bytes);
    if (createOnly) {
      try {
        await link(temp, file);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) return false;
        if (hasCode(error, ...NO_LINK)) return await createExclusive(file, bytes);
        throw error;
      }
    } else await fs.rename(temp, file);
    return true;
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export interface LocalHostOptions {
  /** For tests: replaces `fs.link`. */
  link?: typeof fs.link;
  /** A lock file older than this is treated as left by a crash. Default 30 s. */
  staleLockMs?: number;
  /** How long to wait for a held lock before giving up. Default 2 s. */
  lockWaitMs?: number;
}

/**
 * A registry in a folder, for local runs and for a Pages-style workflow that publishes the folder.
 * ETags are SHA-256 of the content. Writes go to a temp file in the same folder and are renamed into
 * place, so a crash never leaves half a file. A symlink that points out of the folder is refused.
 */
export function localHost(dir: string, options: LocalHostOptions = {}): RegistryHost {
  const root = path.resolve(dir);
  const link = options.link ?? fs.link;
  const staleLockMs = options.staleLockMs ?? 30_000;
  const lockWaitMs = options.lockWaitMs ?? 2000;

  /** Takes `<file>.lock`; a lock older than `staleLockMs` is a crashed writer's and is cleared. */
  async function lockFor(lock: string): Promise<fs.FileHandle> {
    const started = Date.now();
    let delay = 10;
    for (;;) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries until the lock is free
        return await fs.open(lock, 'wx');
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      // oxlint-disable-next-line no-await-in-loop -- retries until the lock is free
      const info = await fs.stat(lock).catch(() => undefined);
      if (info === undefined) continue;
      if (Date.now() - info.mtimeMs > staleLockMs) {
        // oxlint-disable-next-line no-await-in-loop -- retries until the lock is free
        await fs.rm(lock, { force: true });
        continue;
      }
      if (Date.now() - started >= lockWaitMs)
        throw new HostError(
          `${lock} is held by another deploy. If none is running, delete that file and retry.`,
        );
      // oxlint-disable-next-line no-await-in-loop -- retries until the lock is free
      await sleep(delay);
      delay = Math.min(delay * 2, 200);
    }
  }

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
    async put(key, body, put: PutOptions) {
      const file = await fileOf(key);
      const bytes = toBytes(body);
      if (put.ifMatch === undefined) {
        if (!(await write(file, bytes, put.ifNoneMatch === '*', link)))
          throw new PreconditionFailedError(key);
        return { etag: etagOf(bytes) };
      }
      // Check and write under a lock file, so two writers holding the same ETag cannot both win.
      const lock = `${file}.lock`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const handle = await lockFor(lock);
      try {
        const current = await readOrUndefined(file);
        if (current === undefined || etagOf(current) !== put.ifMatch)
          throw new PreconditionFailedError(key);
        await write(file, bytes, false, link);
        return { etag: etagOf(bytes) };
      } finally {
        try {
          await handle.close();
        } finally {
          await fs.rm(lock, { force: true });
        }
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
        .toSorted(byCodePoint);
    },
  };
}
