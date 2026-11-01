import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RegistryIndexRemote } from '@mfeflow/contracts';
import { artifactPrefix, type PutOptions, type RegistryHost } from '../../static';
import { BASE_URL, filesFor, manifestFor, shellManifest } from '../../static/fixtures/remote';
import type { ServerConfig } from '../config';
import { startRegistryServer, type RegistryServer, type StartOptions } from '../server';
import type { ArtifactSource } from '../service';
import { openSqliteStorage } from '../sqlite';
import type { Action, AuditEntry } from '../storage';
import { createToken } from '../tokens';

export { BASE_URL };

/** The JSON the API returns, as the tests read it. Fields are typed as present; each test only reads what its endpoint sends. */
export interface ApiBody {
  ok: boolean;
  changed: boolean;
  killed: boolean;
  env: string;
  generatedAt: string;
  remote: string;
  version: string;
  servedBefore: string | null;
  warnings: string[];
  remotes: RegistryIndexRemote[];
  entries: AuditEntry[];
  error: {
    code: string;
    message: string;
    failures: { code: string; route?: string }[];
  };
}

const noop = (): void => undefined;

export interface MemoryArtifacts extends ArtifactSource {
  files: Map<string, Uint8Array>;
  reads: string[];
  /** Holds every read until released, to make two requests overlap. */
  hold(): () => void;
}

export function memoryArtifacts(): MemoryArtifacts {
  const files = new Map<string, Uint8Array>();
  const reads: string[] = [];
  let gate: Promise<void> | undefined;
  return {
    files,
    reads,
    hold() {
      let release = noop;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        gate = undefined;
      };
    },
    async get(url) {
      reads.push(url);
      if (gate !== undefined) await gate;
      return files.get(url);
    },
  };
}

export interface SeedOptions {
  react?: string;
  entryBytes?: number;
  skip?: string[];
}

/** Puts a remote's build under the artifact base, as an upload step would have. */
export function seedVersion(
  artifacts: MemoryArtifacts,
  name: string,
  version: string,
  options: SeedOptions = {},
): void {
  const manifest = manifestFor(name, options.react);
  const built = filesFor(manifest, options.entryBytes);
  for (const [file, bytes] of Object.entries(built)) {
    if (options.skip?.includes(file) === true) continue;
    artifacts.files.set(`${BASE_URL}/${artifactPrefix(name, version)}/${file}`, bytes);
  }
}

export function seedShell(artifacts: MemoryArtifacts, env: string, react = '19.1.0'): void {
  artifacts.files.set(
    `${BASE_URL}/envs/${env}/shell/mf-manifest.json`,
    new TextEncoder().encode(JSON.stringify(shellManifest(react))),
  );
}

export interface MemoryHost extends RegistryHost {
  puts: { key: string; body: string; options: PutOptions }[];
  failNext: number;
}

export function memoryHost(): MemoryHost {
  const host: MemoryHost = {
    puts: [],
    failNext: 0,
    put(key, body, options) {
      if (host.failNext > 0) {
        host.failNext -= 1;
        return Promise.reject(new Error('host is down'));
      }
      host.puts.push({
        key,
        body: typeof body === 'string' ? body : new TextDecoder().decode(body),
        options,
      });
      return Promise.resolve({});
    },
    get: () => Promise.resolve(undefined),
    head: () => Promise.resolve(undefined),
  };
  return host;
}

export const quiet: StartOptions['log'] = () => undefined;

export interface Harness {
  server: RegistryServer;
  artifacts: MemoryArtifacts;
  host: MemoryHost;
  dbFile: string;
  logs: string[];
  call(
    method: string,
    route: string,
    options?: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string },
  ): Promise<{ status: number; body: ApiBody; headers: Headers }>;
  token(scope?: { env?: string; remote?: string; actions?: Action[] }): Promise<string>;
  /** A token that may do everything everywhere. */
  admin(): Promise<string>;
  /** Registers `name@version` in `env` through the API. */
  deploy(
    token: string,
    name: string,
    version: string,
    env?: string,
  ): Promise<Awaited<ReturnType<Harness['call']>>>;
  stop(): Promise<void>;
}

export async function startHarness(
  overrides: Partial<ServerConfig> = {},
  extra: Partial<StartOptions> = {},
): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-registry-'));
  const dbFile = path.join(dir, 'registry.db');
  const artifacts = memoryArtifacts();
  const host = memoryHost();
  const logs: string[] = [];
  const config: ServerConfig = {
    port: 0,
    bind: '127.0.0.1',
    dbPath: dbFile,
    fallbackHost: undefined,
    artifactBaseUrl: BASE_URL,
    corsOrigins: [],
    maxBodyBytes: 64 * 1024,
    ...overrides,
  };
  const server = await startRegistryServer({
    config,
    storage: await openSqliteStorage(dbFile),
    artifacts,
    fallbackHost: host,
    sleep: () => Promise.resolve(),
    log: (level, message) => logs.push(`${level} ${message}`),
    ...extra,
  });

  const harness: Harness = {
    server,
    artifacts,
    host,
    dbFile,
    logs,
    async call(method, route, options = {}) {
      const headers: Record<string, string> = { ...options.headers };
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      if (options.body !== undefined || options.raw !== undefined)
        headers['content-type'] ??= 'application/json';
      const res = await fetch(`${server.url}${route}`, {
        method,
        headers,
        ...(options.body === undefined && options.raw === undefined
          ? {}
          : { body: options.raw ?? JSON.stringify(options.body) }),
      });
      const text = await res.text();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: the shape is checked by each test's assertions
      const body = (text === '' ? {} : JSON.parse(text)) as ApiBody;
      return { status: res.status, body, headers: res.headers };
    },
    async token(scope = {}) {
      const made = await createToken(server.storage, {
        env: scope.env ?? '*',
        remote: scope.remote ?? '*',
        actions: scope.actions ?? ['read', 'deploy', 'promote', 'rollback', 'kill'],
      });
      return made.token;
    },
    admin: () => harness.token({ actions: ['admin'] }),
    deploy(token, name, version, env = 'prod') {
      seedVersion(artifacts, name, version);
      return harness.call('POST', '/v1/deploy', {
        token,
        body: {
          env,
          remote: name,
          version,
          owner: `team-${name}`,
          routes: [`/${name}`],
          manifestUrl: `${BASE_URL}/${artifactPrefix(name, version)}/mf-manifest.json`,
          budgets: { initialJsKb: 8 },
        },
      });
    },
    async stop() {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
  return harness;
}
