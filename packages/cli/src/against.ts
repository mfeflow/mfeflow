import fs from 'node:fs/promises';
import path from 'node:path';
import { isRegistryProtocol } from '@mfeflow/contracts';
import { getHttps, messageOf, MfeflowError, readCappedText, type FetchLike } from '@mfeflow/core';

const MAX_BYTES = 1_000_000;
const SHELL_MANIFEST = 'shell/mf-manifest.json';

/** The shell a remote is checked against, as its deployed `mf-manifest.json`. */
export interface ShellSource {
  /** What the user passed, for the report. */
  from: string;
  manifest: unknown;
}

const isUrl = (source: string): boolean => /^https?:\/\//i.test(source);
const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function readSource(source: string, cwd: string, fetchImpl: FetchLike): Promise<unknown> {
  let text: string;
  if (isUrl(source)) {
    if (!isRegistryProtocol(new URL(source)))
      throw new Error('must be https (plain http is for localhost only)');
    const response = await getHttps(source, fetchImpl, 'E401', {
      loopback: true,
      blockPrivate: false,
    });
    if (!response.ok) throw new Error(`answered ${String(response.status)}`);
    text = await readCappedText(response, MAX_BYTES, () => new Error('is larger than 1 MB'));
  } else {
    text = await fs.readFile(path.resolve(cwd, source), 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('is larger than 1 MB');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('is not valid JSON');
  }
}

/** Where the shell manifest sits next to a registry index: `envs/<env>/index.json` and `envs/<env>/shell/mf-manifest.json`. */
function besideIndex(source: string): string {
  return isUrl(source)
    ? new URL(SHELL_MANIFEST, source).href
    : path.join(path.dirname(source), SHELL_MANIFEST);
}

const fail = (what: string, why: string, cause?: unknown): never => {
  throw new MfeflowError('E307', `${what}: ${why}`, cause === undefined ? {} : { cause });
};

/**
 * The shell's `mf-manifest.json` from `source`: the manifest itself, or a registry index, whose
 * `shell/mf-manifest.json` is read from beside it. `source` is a file or an https URL (http on
 * localhost). Fails with E307 on anything else.
 */
export async function loadShell(
  source: string,
  options: { cwd: string; fetch: FetchLike },
): Promise<ShellSource> {
  const read = async (from: string): Promise<unknown> => {
    try {
      return await readSource(from, options.cwd, options.fetch);
    } catch (error) {
      return fail(from === source ? source : `${source} (${from})`, messageOf(error), error);
    }
  };
  const first = await read(source);
  if (isObj(first) && Array.isArray(first.shared)) return { from: source, manifest: first };
  if (isObj(first) && Array.isArray(first.remotes)) {
    const manifest = await read(besideIndex(source));
    if (isObj(manifest) && Array.isArray(manifest.shared)) return { from: source, manifest };
    return fail(source, `${SHELL_MANIFEST} beside the index has no "shared" list`);
  }
  return fail(source, 'is neither a registry index nor an mf-manifest.json with a "shared" list');
}
