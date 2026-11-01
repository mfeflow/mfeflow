import crypto from 'node:crypto';
import { ROUTE_OVERLAP, validateRegistryIndex, type RegistryIndex } from '@mfeflow/contracts';
import { artifactPrefix, buildIndex, indexKey, type DeployInput, type GateFailure } from './build';
import { assertSafeKey, HostError, PreconditionFailedError, type RegistryHost } from './host';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const INDEX_CACHE_CONTROL = 'public, max-age=60';

export interface Upload {
  key: string;
  body: Uint8Array | string;
  contentType: string;
  cacheControl: string;
  ifMatch?: string;
  ifNoneMatch?: '*';
  sha256?: string;
}

export interface DeployPlan {
  /** Artifacts first, the index last: a shell never reads an index that points at files not uploaded yet. Empty when a gate failed. */
  uploads: Upload[];
  index: RegistryIndex;
  indexKey: string;
  failures: GateFailure[];
  warnings: string[];
}

export interface PlanInput extends DeployInput {
  /**
   * The ETag of `currentIndex` as the host returned it; the index upload is conditional on it.
   * Required with `currentIndex`. With neither, the index is created only if none exists yet.
   */
  currentIndexEtag?: string;
  /** `Cache-Control` for the index. Its length is how long a rollback takes to reach users. */
  indexCacheControl?: string;
}

const TYPES: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  css: 'text/css',
  html: 'text/html',
  txt: 'text/plain',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
};

export function contentTypeOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return (
    (dot === -1 ? undefined : TYPES[key.slice(dot + 1).toLowerCase()]) ?? 'application/octet-stream'
  );
}

const sha256Of = (body: Uint8Array | string): string =>
  crypto.createHash('sha256').update(body).digest('hex');

const ENV = /^[a-z][a-z0-9-]*$/;

/**
 * What a deploy uploads and the index it leaves behind. Pure: nothing is read or written; give the
 * result to `applyPlan`. A failed gate leaves `uploads` empty.
 */
export function planDeploy(input: PlanInput): DeployPlan {
  if (input.currentIndex !== undefined && input.currentIndexEtag === undefined)
    throw new HostError(
      'currentIndex needs currentIndexEtag, so the index is not overwritten blindly',
    );
  const { index, failures, warnings } = buildIndex(input);
  const key = indexKey(input.env);
  if (!ENV.test(input.env)) {
    failures.push({
      code: 'schema',
      message: `${input.remote.name}@${input.version}: env "${input.env}" must be lowercase letters, digits and -`,
      remote: input.remote.name,
      version: input.version,
    });
  }
  if (failures.length > 0) return { uploads: [], index, indexKey: key, failures, warnings };
  const prefix = artifactPrefix(input.remote.name, input.version);
  const artifacts = Object.entries(input.files)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, body]): Upload => {
      const target = `${prefix}/${file}`;
      assertSafeKey(target);
      return {
        key: target,
        body,
        contentType: contentTypeOf(file),
        cacheControl: IMMUTABLE,
        ifNoneMatch: '*',
        sha256: sha256Of(body),
      };
    });
  const indexUpload: Upload = {
    key,
    body: `${JSON.stringify(index, null, 2)}\n`,
    contentType: 'application/json',
    cacheControl: input.indexCacheControl ?? INDEX_CACHE_CONTROL,
    ...(input.currentIndexEtag === undefined
      ? { ifNoneMatch: '*' as const }
      : { ifMatch: input.currentIndexEtag }),
  };
  return { uploads: [...artifacts, indexUpload], index, indexKey: key, failures, warnings };
}

/** The index a host serves for `env`, with its ETag, or an empty one when none is published yet. */
export async function readIndex(
  host: RegistryHost,
  env: string,
): Promise<{ index: RegistryIndex | undefined; etag?: string }> {
  const stored = await host.get(indexKey(env));
  if (stored === undefined) return { index: undefined };
  const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.body));
  // Existing route overlaps are not a reason to refuse: the next deploy may be the one that fixes them.
  const issues = validateRegistryIndex(parsed).filter((i) => i.code !== ROUTE_OVERLAP);
  if (issues.length > 0)
    throw new HostError(
      `${indexKey(env)} is not a valid registry index: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
    );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validateRegistryIndex just accepted it
  const index = parsed as RegistryIndex;
  return { index, ...(stored.etag === undefined ? {} : { etag: stored.etag }) };
}

export interface ApplyResult {
  uploaded: string[];
  /** Already on the host with identical content: a retry of an earlier deploy. */
  skipped: string[];
}

const differs = (key: string): HostError =>
  new HostError(`${key} is already published with different content; publish a new version`);

/** True when the artifact is already there with the same content, false when it is absent. */
async function alreadyPublished(host: RegistryHost, key: string, hash: string): Promise<boolean> {
  const existing = await host.head(key);
  if (existing === undefined) return false;
  if (existing.sha256 === hash) return true;
  if (existing.sha256 === undefined)
    throw new HostError(
      `${key} is already published and its content cannot be verified; publish a new version`,
    );
  throw differs(key);
}

/**
 * Runs a plan against a host. A version's files are immutable: an artifact already there with the
 * same SHA-256 is skipped, one with different content stops the deploy, and artifacts are written
 * create-only so a concurrent deploy cannot overwrite them. The index goes last.
 */
export async function applyPlan(host: RegistryHost, plan: DeployPlan): Promise<ApplyResult> {
  if (plan.failures.length > 0)
    throw new HostError(`not applying a plan with ${String(plan.failures.length)} failed gate(s)`);
  const result: ApplyResult = { uploaded: [], skipped: [] };
  for (const upload of plan.uploads) {
    const { key, body, ...options } = upload;
    const hash = options.sha256;
    // oxlint-disable-next-line no-await-in-loop -- uploads run in order, the index last
    if (hash !== undefined && (await alreadyPublished(host, key, hash))) {
      result.skipped.push(key);
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- uploads run in order, the index last
      await host.put(key, body, options);
      result.uploaded.push(key);
    } catch (error) {
      if (hash === undefined || !(error instanceof PreconditionFailedError)) throw error;
      // Someone published it between the check and the write: fine if it is the same content.
      // oxlint-disable-next-line no-await-in-loop -- uploads run in order, the index last
      if (!(await alreadyPublished(host, key, hash))) throw error;
      result.skipped.push(key);
    }
  }
  return result;
}
