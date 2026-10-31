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

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

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
  if (parsed.protocol !== 'https:') throw new MfeflowError('E401', `${url} is not https`);
  return parsed.href;
}

/** Downloads the feature.json text for `@ns/name`. */
export async function fetchRemoteText(
  name: string,
  registries: Record<string, string>,
  fetchImpl: FetchLike = realFetch,
  version?: string,
): Promise<string> {
  const url = registryUrl(name, registries, version);
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new MfeflowError('E401', `${url} (${messageOf(error)})`, { cause: error });
  }
  if (response.url !== undefined && response.url !== '' && !response.url.startsWith('https://')) {
    throw new MfeflowError('E401', `${url} redirected away from https`);
  }
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
