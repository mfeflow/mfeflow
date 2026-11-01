import { DEFAULT_GATE, type GateSettings } from './gate';

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`invalid registry server settings:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface ServerConfig {
  port: number;
  /** Address to bind. Loopback unless you set it. */
  bind: string;
  /** SQLite file. */
  dbPath: string;
  /** `file:<dir>` or `s3://<bucket>[/prefix]`: where the stable-only fallback `index.json` is republished. */
  fallbackHost: string | undefined;
  /** Where artifacts are served from. `deploy` accepts only manifest URLs under it. */
  artifactBaseUrl: string | undefined;
  /** Origins allowed to read the index endpoint from a browser. Empty: no CORS headers at all. */
  corsOrigins: string[];
  maxBodyBytes: number;
  /** When a rollout candidate is halted. */
  gate: GateSettings;
  /** Beacons allowed per client address. */
  beaconLimit: { burst: number; perMinute: number };
  /** Read the client address from `X-Forwarded-For`; only behind your own proxy. */
  trustProxy: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const present = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
};

function integer(
  env: Env,
  name: string,
  fallback: number,
  [min, max]: [number, number],
  problems: string[],
): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number from ${String(min)} to ${String(max)}`);
    return fallback;
  }
  return value;
}

function decimal(
  env: Env,
  name: string,
  fallback: number,
  [min, max]: [number, number],
  problems: string[],
): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    problems.push(`${name} must be a number from ${String(min)} to ${String(max)}`);
    return fallback;
  }
  return value;
}

const isLoopback = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

function parseUrl(raw: string, name: string, problems: string[]): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`${name}: "${raw}" is not a URL`);
    return undefined;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    problems.push(`${name}: "${raw}" must be https (http only on localhost)`);
    return undefined;
  }
  return url;
}

/** Linear in the length, unlike a regex on a long run of slashes. */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end -= 1;
  return path.slice(0, end);
}

function artifactBase(env: Env, problems: string[]): string | undefined {
  const name = 'MFEFLOW_REGISTRY_ARTIFACT_BASE_URL';
  const raw = present(env, name);
  if (raw === undefined) return undefined;
  const url = parseUrl(raw, name, problems);
  if (url === undefined) return undefined;
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    problems.push(`${name} must not carry a query, fragment or login`);
    return undefined;
  }
  return `${url.origin}${trimTrailingSlashes(url.pathname)}`;
}

/** Reads and checks the server's settings. Every problem is reported at once. */
export function configFromEnv(env: Env): ServerConfig {
  const problems: string[] = [];
  const port = integer(env, 'MFEFLOW_REGISTRY_PORT', 8787, [0, 65_535], problems);
  const maxBodyBytes = integer(
    env,
    'MFEFLOW_REGISTRY_MAX_BODY_BYTES',
    256 * 1024,
    [1024, 16 * 1024 * 1024],
    problems,
  );
  const corsOrigins = (present(env, 'MFEFLOW_REGISTRY_CORS_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => parseUrl(s, 'MFEFLOW_REGISTRY_CORS_ORIGINS', problems)?.origin)
    .filter((s) => s !== undefined);
  const artifactBaseUrl = artifactBase(env, problems);
  const gate: GateSettings = {
    minLoads: integer(
      env,
      'MFEFLOW_REGISTRY_GATE_MIN_LOADS',
      DEFAULT_GATE.minLoads,
      [1, 1_000_000],
      problems,
    ),
    minClients: integer(
      env,
      'MFEFLOW_REGISTRY_GATE_MIN_CLIENTS',
      DEFAULT_GATE.minClients,
      [1, 1_000_000],
      problems,
    ),
    factor: decimal(env, 'MFEFLOW_REGISTRY_GATE_FACTOR', DEFAULT_GATE.factor, [1, 100], problems),
    floor: decimal(env, 'MFEFLOW_REGISTRY_GATE_FLOOR', DEFAULT_GATE.floor, [0, 1], problems),
  };
  const beaconLimit = {
    burst: integer(env, 'MFEFLOW_REGISTRY_BEACON_BURST', 60, [1, 10_000], problems),
    perMinute: integer(env, 'MFEFLOW_REGISTRY_BEACON_PER_MINUTE', 60, [1, 100_000], problems),
  };
  const trustProxy = present(env, 'MFEFLOW_REGISTRY_TRUST_PROXY') === 'true';
  if (problems.length > 0) throw new ConfigError(problems);
  return {
    port,
    bind: present(env, 'MFEFLOW_REGISTRY_BIND') ?? '127.0.0.1',
    dbPath: present(env, 'MFEFLOW_REGISTRY_DB') ?? './mfeflow-registry.db',
    fallbackHost: present(env, 'MFEFLOW_REGISTRY_FALLBACK_HOST'),
    artifactBaseUrl,
    corsOrigins,
    maxBodyBytes,
    gate,
    beaconLimit,
    trustProxy,
  };
}

/** Values that must never reach a log line. */
export function secretsOf(env: Env): string[] {
  return ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']
    .map((name) => present(env, name))
    .filter((value) => value !== undefined);
}
