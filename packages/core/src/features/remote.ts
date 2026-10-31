import { MfeflowError, messageOf } from '../errors.js';

/** The part of `Response` the loader uses, so tests can pass a plain object. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  url?: string;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** The URL a namespaced feature lives at. `{name}` is the part after the slash, URL-encoded. */
export function registryUrl(name: string, registries: Record<string, string>): string {
  const slash = name.indexOf('/');
  const namespace = name.slice(0, slash);
  const bare = name.slice(slash + 1);
  const template = registries[namespace];
  if (template === undefined) throw new MfeflowError('E210', namespace);
  const url = template.replaceAll('{name}', encodeURIComponent(bare));
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
): Promise<string> {
  const url = registryUrl(name, registries);
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
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new MfeflowError('E402', `${url} is larger than 1 MB`);
  return text;
}
