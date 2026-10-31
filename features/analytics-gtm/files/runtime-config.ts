const KEY = '__MFE_RUNTIME_CONFIG__';
const URL = '/config/runtime-config.json';

type Config = Record<string, unknown>;

let pending: Promise<Config> | undefined;

function isConfig(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function load(): Promise<Config> {
  try {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`${URL} answered ${String(response.status)}`);
    const json: unknown = await response.json();
    if (!isConfig(json)) return {};
    Reflect.set(globalThis, KEY, json);
    return json;
  } catch (error) {
    console.warn('[runtime-config] did not load, so features that need it stay off', error);
    return {};
  }
}

/** The runtime config: the one the shell already loaded, else the file itself, fetched once. A failure gives an empty config. */
export function runtimeConfig(): Promise<Config> {
  const loaded: unknown = Reflect.get(globalThis, KEY);
  if (isConfig(loaded)) return Promise.resolve(loaded);
  pending ??= load();
  return pending;
}
