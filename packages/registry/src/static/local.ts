import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertSafeKey,
  PreconditionFailedError,
  toBytes,
  type ObjectInfo,
  type PutOptions,
  type RegistryHost,
  type StoredObject,
} from './host';

const etagOf = (body: Uint8Array): string =>
  `"${crypto.createHash('sha256').update(body).digest('hex')}"`;

async function readOrUndefined(file: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return undefined;
    throw error;
  }
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- depth-first walk
      await walk(dir, next, out);
    } else out.push(next);
  }
}

/** A registry in a folder, for local runs and for a Pages-style workflow that publishes the folder. ETags are SHA-256 of the content. */
export function localHost(dir: string): RegistryHost {
  const root = path.resolve(dir);
  const fileOf = (key: string): string => {
    assertSafeKey(key);
    const file = path.join(root, ...key.split('/'));
    if (!file.startsWith(root + path.sep)) throw new Error(`key "${key}" is outside ${root}`);
    return file;
  };
  return {
    async put(key, body, options: PutOptions) {
      const file = fileOf(key);
      const bytes = toBytes(body);
      if (options.ifMatch !== undefined) {
        const current = await readOrUndefined(file);
        if (current === undefined || etagOf(current) !== options.ifMatch)
          throw new PreconditionFailedError(key);
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      return { etag: etagOf(bytes) };
    },
    async get(key): Promise<StoredObject | undefined> {
      const body = await readOrUndefined(fileOf(key));
      return body === undefined ? undefined : { body, etag: etagOf(body) };
    },
    async head(key): Promise<ObjectInfo | undefined> {
      const body = await readOrUndefined(fileOf(key));
      return body === undefined ? undefined : { etag: etagOf(body), size: body.length };
    },
    async list(prefix) {
      const all: string[] = [];
      await walk(root, '', all);
      return all.filter((key) => key.startsWith(prefix)).toSorted();
    },
  };
}
