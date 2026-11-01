import {
  isLoopbackHttp,
  isRegistryProtocol,
  registryIndexUrl,
  registryTemplateProblem,
  validateFeatureRegistryIndex,
  type FeatureRegistryItem,
} from '@mfeflow/contracts';
import { MfeflowError, messageOf } from '../errors';

/** The part of `Response` the loader uses, so tests can pass a plain object. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  url?: string;
  headers?: { get(name: string): string | null };
  /** When present the body is read from it, a chunk at a time, so the size cap holds. */
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; redirect?: 'follow' | 'manual' },
) => Promise<FetchResponse>;

/** Largest feature.json or index.json a registry may serve; `registry build` refuses to write more. */
export const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const realFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * The URL a namespaced feature lives at. `{name}` is the part after the slash and
 * `{version}` the version asked for (`latest` when none), both URL-encoded.
 */
export function registryUrl(
  name: string,
  registries: Record<string, string>,
  version?: string,
): string {
  const slash = name.indexOf('/');
  const namespace = name.slice(0, slash);
  const bare = name.slice(slash + 1);
  const template = registries[namespace];
  if (template === undefined) throw new MfeflowError('E210', namespace);
  const url = template
    .replaceAll('{name}', encodeURIComponent(bare))
    .replaceAll('{version}', encodeURIComponent(version ?? 'latest'));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new MfeflowError('E401', `${namespace} has an invalid URL (${url})`, { cause: error });
  }
  if (!isRegistryProtocol(parsed)) {
    throw new MfeflowError(
      'E401',
      `${url} is not https (plain http is for 127.0.0.1, localhost and [::1] only)`,
    );
  }
  return parsed.href;
}

/**
 * GETs `url`, following redirects by hand so one that leaves https is refused before it is
 * requested. `code` is the error every failure here throws. With `loopback`, a URL that starts
 * on plain http at 127.0.0.1, localhost or [::1] may stay on such a host; nothing else may
 * step down to http, and an https URL never ends up on one.
 */
export async function getHttps(
  url: string,
  fetchImpl: FetchLike,
  code: 'E109' | 'E401',
  options: { loopback?: boolean } = {},
): Promise<FetchResponse> {
  const fail = (at: string, why: string, cause?: unknown): never => {
    throw new MfeflowError(code, `${at}: ${why}`, cause === undefined ? {} : { cause });
  };
  const startsLoopback = options.loopback === true && isLoopbackHttp(new URL(url));
  const permitted = (target: URL): boolean =>
    target.protocol === 'https:' || (startsLoopback && isLoopbackHttp(target));
  const addressOk = (address: string): boolean => {
    try {
      return permitted(new URL(address));
    } catch {
      return false;
    }
  };
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: FetchResponse;
    try {
      // oxlint-disable-next-line no-await-in-loop -- each hop depends on the last answer
      response = await fetchImpl(current, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error) {
      return fail(current, messageOf(error), error);
    }
    if (response.url !== undefined && response.url !== '' && !addressOk(response.url)) {
      fail(url, `ended up at ${response.url}, which is not https`);
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get('location');
    // oxlint-disable-next-line no-await-in-loop -- the redirect body is not wanted
    await response.body?.cancel().catch(() => undefined);
    if (location === null || location === undefined || location === '') {
      fail(current, `redirected (${String(response.status)}) with no address`);
    }
    let next: URL;
    try {
      next = new URL(location ?? '', current);
    } catch (error) {
      return fail(current, 'redirected to a bad address', error);
    }
    if (!permitted(next)) fail(url, `redirected to ${next.href}, which is not https`);
    current = next.href;
  }
  return fail(url, 'redirected too many times');
}

/** Downloads the feature.json text for `@ns/name`. */
export async function fetchRemoteText(
  name: string,
  registries: Record<string, string>,
  fetchImpl: FetchLike = realFetch,
  version?: string,
): Promise<string> {
  const url = registryUrl(name, registries, version);
  const response = await getHttps(url, fetchImpl, 'E401', { loopback: true });
  if (!response.ok) {
    const hint = response.status === 404 ? `${name} is not in that registry` : undefined;
    throw new MfeflowError(
      'E401',
      `${url} answered ${String(response.status)}${hint ? `: ${hint}` : ''}`,
    );
  }
  return readCappedText(
    response,
    MAX_BYTES,
    () => new MfeflowError('E402', `${url} is larger than 1 MB`),
  );
}

/**
 * The body of `response` as text, refusing more than `maxBytes`: from the declared
 * length first, then on the bytes actually streamed, so an oversized answer is
 * cancelled instead of downloaded. `tooBig` builds the error to throw.
 */
export async function readCappedText(
  response: FetchResponse,
  maxBytes: number,
  tooBig: () => Error,
): Promise<string> {
  const declared = Number(response.headers?.get('content-length') ?? Number.NaN);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooBig();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving the loop early cancels the stream, so an oversized answer is not downloaded to the end.
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw tooBig();
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The items `<namespace>`'s `index.json` lists. The index sits in the folder the registry's URL
 * template starts in (see `registryIndexUrl`). Fails with E401 when it cannot be fetched and E403
 * when it is not an index, so a caller can show one registry's problem and carry on with the rest.
 */
export async function fetchFeatureIndex(
  namespace: string,
  registries: Record<string, string>,
  fetchImpl: FetchLike = realFetch,
): Promise<FeatureRegistryItem[]> {
  const template = registries[namespace];
  if (template === undefined) throw new MfeflowError('E210', namespace);
  const problem = registryTemplateProblem(template);
  if (problem !== undefined) throw new MfeflowError('E401', `${namespace}: ${problem}`);
  const url = registryIndexUrl(template);
  const response = await getHttps(url, fetchImpl, 'E401', { loopback: true });
  if (!response.ok) {
    const hint = response.status === 404 ? ': this registry has no index.json' : '';
    throw new MfeflowError('E401', `${url} answered ${String(response.status)}${hint}`);
  }
  const text = await readCappedText(
    response,
    MAX_BYTES,
    () => new MfeflowError('E403', `${url} is larger than 1 MB`),
  );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MfeflowError('E403', `${url} is not JSON (${messageOf(error)})`, { cause: error });
  }
  const issues = validateFeatureRegistryIndex(value);
  if (issues.length > 0) {
    const shown = issues.slice(0, 3).map((i) => `${i.path || '(root)'} ${i.message}`);
    const more = issues.length > 3 ? `; and ${String(issues.length - 3)} more` : '';
    throw new MfeflowError('E403', `${url}: ${shown.join('; ')}${more}`);
  }
  return itemsOf(value);
}

function itemsOf(value: unknown): FeatureRegistryItem[] {
  // validateFeatureRegistryIndex has accepted the shape.
  const holder: { items: FeatureRegistryItem[] } = { items: [] };
  Object.assign(holder, value);
  return holder.items;
}
