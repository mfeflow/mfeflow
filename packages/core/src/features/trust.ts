import os from 'node:os';
import path from 'node:path';
import { REGISTRY_NAMESPACE, registryTemplateProblem } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import { readIfExists, realFs, writeFileAtomic, type FsOps } from '../fs';

/** A registry the user has accepted: this namespace at exactly this URL template. */
export interface TrustedRegistry {
  namespace: string;
  template: string;
}

export const TRUST_FILE = 'trusted-registries.json';

/** Names the namespaces to trust for one run without touching the trust file, like `@a,@b`. For CI. */
export const TRUST_ENV = 'MFEFLOW_TRUST_REGISTRIES';

const set = (value: string | undefined) =>
  value === undefined || value === '' ? undefined : value;

/**
 * Where mfeflow keeps per-user settings: `MFEFLOW_CONFIG_DIR`, else `$XDG_CONFIG_HOME/mfeflow`,
 * else `%APPDATA%\mfeflow` on Windows, else `~/.config/mfeflow`.
 */
export function configDirOf(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const override = set(env.MFEFLOW_CONFIG_DIR);
  if (override !== undefined) return override;
  const xdg = set(env.XDG_CONFIG_HOME);
  if (xdg !== undefined) return path.join(xdg, 'mfeflow');
  const appData = set(env.APPDATA);
  if (platform === 'win32' && appData !== undefined) return path.join(appData, 'mfeflow');
  return path.join(home, '.config', 'mfeflow');
}

export function trustFileIn(configDir: string): string {
  return path.join(configDir, TRUST_FILE);
}

function isEntry(value: unknown): value is TrustedRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const { namespace, template } = Object.fromEntries(Object.entries(value));
  return (
    typeof namespace === 'string' &&
    REGISTRY_NAMESPACE.test(namespace) &&
    typeof template === 'string' &&
    registryTemplateProblem(template) === undefined
  );
}

/**
 * What the user has trusted. A missing, unreadable or malformed file trusts nothing, so a damaged
 * file fails closed and the next `registry trust` replaces it.
 */
export async function readTrusted(
  configDir: string,
  ops: FsOps = realFs,
): Promise<TrustedRegistry[]> {
  let text: string | undefined;
  try {
    text = await readIfExists(ops, trustFileIn(configDir));
  } catch {
    return [];
  }
  if (text === undefined) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return [];
    const { registries } = Object.fromEntries(Object.entries(value));
    return Array.isArray(registries) ? registries.filter(isEntry) : [];
  } catch {
    return [];
  }
}

async function save(configDir: string, entries: TrustedRegistry[], ops: FsOps): Promise<void> {
  const sorted = entries.toSorted(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.template.localeCompare(b.template),
  );
  const body = `${JSON.stringify({ version: 1, registries: sorted }, null, 2)}\n`;
  try {
    await writeFileAtomic(ops, trustFileIn(configDir), body);
  } catch (error) {
    throw new MfeflowError('E106', trustFileIn(configDir), { cause: error });
  }
}

/** Records `entry`. Returns false when it was already trusted. */
export async function addTrusted(
  configDir: string,
  entry: TrustedRegistry,
  ops: FsOps = realFs,
): Promise<boolean> {
  const current = await readTrusted(configDir, ops);
  if (current.some((e) => e.namespace === entry.namespace && e.template === entry.template)) {
    return false;
  }
  await save(configDir, [...current, entry], ops);
  return true;
}

/** Forgets everything trusted under `namespace`. Returns how many entries went. */
export async function removeTrusted(
  configDir: string,
  namespace: string,
  ops: FsOps = realFs,
): Promise<number> {
  const current = await readTrusted(configDir, ops);
  const kept = current.filter((e) => e.namespace !== namespace);
  if (kept.length === current.length) return 0;
  await save(configDir, kept, ops);
  return current.length - kept.length;
}

/** The namespaces in `value` (`@a,@b`), as `TRUST_ENV` spells them. */
export function namespacesFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => REGISTRY_NAMESPACE.test(part));
}

/**
 * The namespaces in `registries` the user trusts: recorded with this very template, or named in
 * `fromEnv`. A namespace whose URL changed since it was trusted is not trusted any more.
 */
export function trustedNamespaces(
  registries: Record<string, string>,
  recorded: readonly TrustedRegistry[],
  fromEnv: readonly string[] = [],
): Set<string> {
  return new Set(
    Object.entries(registries)
      .filter(
        ([namespace, template]) =>
          fromEnv.includes(namespace) ||
          recorded.some((e) => e.namespace === namespace && e.template === template),
      )
      .map(([namespace]) => namespace),
  );
}
