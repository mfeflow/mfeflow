/** Where the shell keeps the runtime config once loaded: `globalThis[RUNTIME_CONFIG_KEY]`. */
export const RUNTIME_CONFIG_KEY = '__MFE_RUNTIME_CONFIG__';
/** The file the shell fetches: `public/config/runtime-config.json`, or the one for the environment in a deployment. */
export const RUNTIME_CONFIG_URL = '/config/runtime-config.json';

export type RuntimeConfigValues = Record<string, unknown>;

// On globalThis so a second copy of this package shares the one fetch.
const PENDING = Symbol.for('mfeflow.runtime-config');

const isConfig = (value: unknown): value is RuntimeConfigValues =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Pending {
  promise: Promise<RuntimeConfigValues>;
}

const isPending = (value: unknown): value is Pending =>
  typeof value === 'object' && value !== null && Reflect.get(value, 'promise') instanceof Promise;

async function load(url: string): Promise<RuntimeConfigValues> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  const json: unknown = await response.json();
  if (!isConfig(json)) throw new Error(`${url} is not a JSON object`);
  Reflect.set(globalThis, RUNTIME_CONFIG_KEY, json);
  return json;
}

/**
 * The runtime config: the one already on `globalThis`, else the file, fetched once. Every caller
 * (the typed `loadRuntimeConfig` of env-t3, analytics, telemetry) gets the same promise, so the
 * file is requested once however many features read it. It rejects if the file cannot be loaded
 * (the same rejection for every caller; there is no retry), so each caller decides what to do
 * without it.
 */
export function fetchRuntimeConfig(url = RUNTIME_CONFIG_URL): Promise<RuntimeConfigValues> {
  const loaded: unknown = Reflect.get(globalThis, RUNTIME_CONFIG_KEY);
  if (isConfig(loaded)) return Promise.resolve(loaded);
  const existing: unknown = Reflect.get(globalThis, PENDING);
  if (isPending(existing)) return existing.promise;
  const pending: Pending = { promise: load(url) };
  Reflect.set(globalThis, PENDING, pending);
  return pending.promise;
}

/** Forgets the loaded config and the fetch. For tests. */
export function resetRuntimeConfigForTests(): void {
  Reflect.deleteProperty(globalThis, RUNTIME_CONFIG_KEY);
  Reflect.deleteProperty(globalThis, PENDING);
}
