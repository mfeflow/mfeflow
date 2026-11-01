import { MfeflowError } from '@mfeflow/core';

export interface RemoteSpec {
  name: string;
  port: number;
}

/** The dev server of each remote, relative to the shell app: the one place a polyrepo shell reads them from. */
export const DEV_CONFIG = 'apps/shell/public/config/runtime-config.dev.json';
export const DEV_CONFIG_IN_APP = 'public/config/runtime-config.dev.json';

const manifestUrl = (port: number): string => `http://localhost:${String(port)}/mf-manifest.json`;

/** `runtime-config.dev.json` of the shell: where each remote's dev server is. */
export function devConfigText(remotes: readonly RemoteSpec[]): string {
  const devRemotes = Object.fromEntries(remotes.map((r) => [r.name, manifestUrl(r.port)]));
  return `${JSON.stringify({ environment: 'dev', devRemotes }, null, 2)}\n`;
}

/** The `devRemotes` of a shell's dev config; empty when the file or the key is missing. */
export function readDevRemotes(text: string | undefined): Record<string, string> {
  if (text === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MfeflowError('E104', `${DEV_CONFIG} is not valid JSON`, { cause: error });
  }
  const remotes: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'devRemotes') : undefined;
  if (typeof remotes !== 'object' || remotes === null) return {};
  return Object.fromEntries(
    Object.entries(remotes).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/** `text` with one more remote in `devRemotes`. */
export function withDevRemote(text: string, remote: RemoteSpec): string {
  const known = readDevRemotes(text);
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) value = { ...parsed };
  } catch (error) {
    throw new MfeflowError('E104', `${DEV_CONFIG} is not valid JSON`, { cause: error });
  }
  const devRemotes = { ...known, [remote.name]: manifestUrl(remote.port) };
  return `${JSON.stringify({ ...value, devRemotes }, null, 2)}\n`;
}

/** The port of a dev URL like `http://localhost:4311/mf-manifest.json`. */
export function portOf(url: string): number | undefined {
  try {
    const port = Number(new URL(url).port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}
