import fs from 'node:fs/promises';
import path from 'node:path';
import {
  messageOf,
  MfeflowError,
  readCappedText,
  type FetchLike,
  type FetchResponse,
} from '@mfeflow/core';

/** The options a preset may carry: the same names as the flags of `init`. */
export interface Preset {
  scope?: string;
  remotes?: string[];
  features?: string[];
  packageManager?: string;
  topology?: string;
  options?: Record<string, Record<string, unknown>>;
}

const MAX_BYTES = 100_000;
const TIMEOUT_MS = 10_000;
const KEYS = new Set([
  '$schema',
  'scope',
  'remotes',
  'features',
  'packageManager',
  'topology',
  'options',
]);

function bad(source: string, why: string): never {
  throw new MfeflowError('E109', `${source}: ${why}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(source: string, key: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    bad(source, `${key} must be a list of text`);
  }
  return value;
}

function optionsOf(source: string, value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) bad(source, 'options must be an object of feature names');
  const out: Record<string, Record<string, unknown>> = {};
  for (const [feature, given] of Object.entries(value)) {
    if (!isRecord(given)) bad(source, `options.${feature} must be an object`);
    out[feature] = given;
  }
  return out;
}

/** Checks a parsed preset. Unknown keys are an error, so a typo does not silently do nothing. */
export function parsePreset(source: string, value: unknown): Preset {
  if (!isRecord(value)) bad(source, 'must be a JSON object');
  const preset: Preset = {};
  for (const [key, item] of Object.entries(value)) {
    if (!KEYS.has(key)) bad(source, `"${key}" is not a preset option`);
    if (key === 'scope' || key === 'packageManager' || key === 'topology') {
      if (typeof item !== 'string') bad(source, `${key} must be text`);
      preset[key] = item;
    } else if (key === 'remotes' || key === 'features') {
      preset[key] = stringList(source, key, item);
    } else if (key === 'options') {
      preset.options = optionsOf(source, item);
    }
  }
  return preset;
}

export interface PresetSources {
  cwd: string;
  fetch: FetchLike;
  readFile?: (file: string) => Promise<string>;
}

const MAX_REDIRECTS = 5;

/** Follows redirects by hand so one that leaves https is refused before it is requested. */
async function getHttps(url: string, fetchImpl: FetchLike): Promise<FetchResponse> {
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
      throw new MfeflowError('E109', `${current}: ${messageOf(error)}`, { cause: error });
    }
    if (response.url !== undefined && response.url !== '' && !response.url.startsWith('https://')) {
      bad(url, `ended up at ${response.url}, which is not https`);
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get('location');
    // oxlint-disable-next-line no-await-in-loop -- the redirect body is not wanted
    await response.body?.cancel().catch(() => undefined);
    if (location === null || location === undefined || location === '') {
      bad(current, `redirected (${String(response.status)}) with no address`);
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch (error) {
      throw new MfeflowError('E109', `${current}: redirected to a bad address`, { cause: error });
    }
    if (next.protocol !== 'https:') bad(url, `redirected to ${next.href}, which is not https`);
    current = next.href;
  }
  return bad(url, 'redirected too many times');
}

async function readUrl(url: string, fetchImpl: FetchLike): Promise<string> {
  const response = await getHttps(url, fetchImpl);
  if (!response.ok) bad(url, `answered ${String(response.status)}`);
  return readCappedText(
    response,
    MAX_BYTES,
    () => new MfeflowError('E109', `${url}: is larger than 100 KB`),
  );
}

/** Loads a preset from a file path or an https URL. Plain http is refused. */
export async function loadPreset(source: string, sources: PresetSources): Promise<Preset> {
  let text: string;
  if (/^https?:\/\//i.test(source)) {
    if (!source.toLowerCase().startsWith('https://')) bad(source, 'must be https');
    text = await readUrl(source, sources.fetch);
  } else {
    const file = path.resolve(sources.cwd, source);
    try {
      text = await (sources.readFile ?? ((f) => fs.readFile(f, 'utf8')))(file);
    } catch (error) {
      throw new MfeflowError('E109', `${file}: ${messageOf(error)}`, { cause: error });
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MfeflowError('E109', `${source}: not valid JSON (${messageOf(error)})`, {
      cause: error,
    });
  }
  return parsePreset(source, value);
}
