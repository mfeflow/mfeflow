import http from 'node:http';
import type { RegistryHost } from '../static';
import { fetchArtifactSource } from './artifacts';
import type { ServerConfig } from './config';
import { FallbackPublisher, type Log } from './fallback';
import { openHost, parseHostSpec } from './host-spec';
import { createHandler } from './http';
import { RegistryService, type ArtifactSource } from './service';
import { openSqliteStorage } from './sqlite';
import type { RegistryStorage } from './storage';

export interface StartOptions {
  config: ServerConfig;
  /** The process environment, for S3 credentials. */
  env?: Readonly<Record<string, string | undefined>>;
  log?: Log;
  secrets?: readonly string[];
  /** Tests give in-memory pieces; production leaves these out. */
  storage?: RegistryStorage;
  artifacts?: ArtifactSource;
  fallbackHost?: RegistryHost;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  /** How long `close()` lets running requests finish before it cuts them. Default 10 s. */
  drainMs?: number;
}

export interface RegistryServer {
  service: RegistryService;
  storage: RegistryStorage;
  fallback: FallbackPublisher | undefined;
  /** `http://127.0.0.1:<port>` once listening. */
  url: string;
  close(): Promise<void>;
}

export const consoleLog = (secrets: readonly string[]): Log => {
  const redact = (text: string): string =>
    secrets.reduce((out, secret) => out.replaceAll(secret, '***'), text);
  return (level, message) => {
    const line = `${new Date().toISOString()} ${level} ${redact(message)}\n`;
    (level === 'info' ? process.stdout : process.stderr).write(line);
  };
};

/** Opens storage, starts the fallback publisher and listens. Resolves once the port is bound. */
export async function startRegistryServer(options: StartOptions): Promise<RegistryServer> {
  const { config } = options;
  const env = options.env ?? {};
  const secrets = options.secrets ?? [];
  const log = options.log ?? consoleLog(secrets);
  const storage = options.storage ?? (await openSqliteStorage(config.dbPath));
  const artifacts = options.artifacts ?? fetchArtifactSource();

  const fallbackHost =
    options.fallbackHost ??
    (config.fallbackHost === undefined
      ? undefined
      : openHost(parseHostSpec(config.fallbackHost, process.cwd()), env));
  if (fallbackHost === undefined)
    log(
      'warn',
      'no fallback host set: shells cannot boot from a static index if this server is down',
    );

  let service: RegistryService | undefined;
  const fallback =
    fallbackHost === undefined
      ? undefined
      : new FallbackPublisher({
          host: fallbackHost,
          stableIndex: (e) => (service ?? never()).stableIndex(e),
          log,
          redact: (text) => secrets.reduce((out, s) => out.replaceAll(s, '***'), text),
          ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        });
  service = new RegistryService({
    storage,
    artifacts,
    artifactBaseUrl: config.artifactBaseUrl,
    gate: config.gate,
    ...(options.now === undefined ? {} : { now: options.now }),
    onChange: (changed) => fallback?.request(changed),
    log,
  });

  const server = http.createServer(
    createHandler({
      service,
      storage,
      corsOrigins: config.corsOrigins,
      maxBodyBytes: config.maxBodyBytes,
      beaconLimit: config.beaconLimit,
      trustProxy: config.trustProxy,
      log,
    }),
  );
  if (!config.trustProxy && !/^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(config.bind))
    log(
      'warn',
      `bound to ${config.bind} without MFEFLOW_REGISTRY_TRUST_PROXY=true: beacons are rate limited per socket address, so behind a proxy every browser shares one limit`,
    );
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.bind, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  const host = config.bind.includes(':') ? `[${config.bind}]` : config.bind;
  for (const known of await storage.listEnvs()) fallback?.request(known);
  log('info', `registry server listening on http://${host}:${String(port)}`);

  return {
    service,
    storage,
    fallback,
    url: `http://${host}:${String(port)}`,
    async close() {
      await new Promise<void>((resolve) => {
        const cut = setTimeout(() => server.closeAllConnections(), options.drainMs ?? 10_000);
        server.close(() => {
          clearTimeout(cut);
          resolve();
        });
        server.closeIdleConnections();
      });
      await fallback?.close();
      await storage.close();
    },
  };
}

function never(): never {
  throw new Error('the registry service is not ready');
}
