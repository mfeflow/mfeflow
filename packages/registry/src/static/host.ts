import { isPortableRelativePath } from '@mfeflow/contracts';

export interface PutOptions {
  contentType: string;
  cacheControl: string;
  /** Only write when the stored object still has this ETag; the index uses it so two deploys cannot overwrite each other. */
  ifMatch?: string;
  /** Only write when nothing is stored under the key yet. Artifacts and a first index use it so a race cannot overwrite. */
  ifNoneMatch?: '*';
  /** Hex SHA-256 of the body, kept with the object so a later deploy can tell identical content from different. */
  sha256?: string;
}

export interface StoredObject {
  body: Uint8Array;
  etag?: string;
}

export interface ObjectInfo {
  etag?: string;
  size?: number;
  /** The `sha256` given at put time, when the host kept it. */
  sha256?: string;
}

/** Where a static registry lives: a folder, a bucket, anything that stores files by key. */
export interface RegistryHost {
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<{ etag?: string }>;
  /** Undefined when the key does not exist. */
  get(key: string): Promise<StoredObject | undefined>;
  head(key: string): Promise<ObjectInfo | undefined>;
  list?(prefix: string): Promise<string[]>;
}

/** The stored object changed since it was read (HTTP 412). Read it again and redo the deploy. */
export class PreconditionFailedError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `${key} changed since it was read, so it was not overwritten. Read the index again and retry.`,
    );
    this.name = 'PreconditionFailedError';
    this.key = key;
  }
}

export class HostError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HostError';
    this.status = status;
  }
}

/** The host refused the request for lack of permission. A missing key can look like this on S3 without `s3:ListBucket`. */
export class AccessDeniedError extends HostError {
  constructor(message: string) {
    super(message, 403);
    this.name = 'AccessDeniedError';
  }
}

/** Throws unless `key` is a plain relative path with forward slashes: no `..`, no absolute path, no drive letter, no backslash. */
export function assertSafeKey(key: string): void {
  if (!isPortableRelativePath(key)) throw new HostError(`unsafe key "${key}"`);
}

/** `1.4.2+a1b2c3d` → `1.4.2_a1b2c3d`. `_` never occurs in a semver version, so keys stay unique and need no URL escaping. */
export const versionKey = (version: string): string => version.replaceAll('+', '_');

export const toBytes = (body: Uint8Array | string): Uint8Array =>
  typeof body === 'string' ? new TextEncoder().encode(body) : body;
