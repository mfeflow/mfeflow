const KEY = '__MFE_RUNTIME_CONFIG__';
const URL = '/config/runtime-config.json';

export type Config = Record<string, unknown>;

let pending: Promise<Config> | undefined;

const isConfig = (value: unknown): value is Config =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function load(): Promise<Config> {
  try {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`${URL} answered ${String(response.status)}`);
    const json: unknown = await response.json();
    if (!isConfig(json)) return {};
    Reflect.set(globalThis, KEY, json);
    return json;
  } catch (error) {
    console.warn('[runtime-config] did not load, so analytics and telemetry stay off', error);
    return {};
  }
}

/** The runtime config the shell fetched at boot, as the generated projects read it. */
export function runtimeConfig(): Promise<Config> {
  pending ??= load();
  return pending;
}
