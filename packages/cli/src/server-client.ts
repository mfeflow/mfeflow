import { isLoopbackHttp, type RegistryIndex } from '@mfeflow/contracts';
import { messageOf, MfeflowError, type ErrorCode } from '@mfeflow/core';
import { text } from './args';
import { redact } from './hosts';
import type { Runtime } from './runtime';

export const URL_ENV = 'MFEFLOW_REGISTRY_URL';
export const TOKEN_ENV = 'MFEFLOW_REGISTRY_TOKEN';

const TIMEOUT_MS = 30_000;
const SERVER_FIX = `Check ${URL_ENV} and ${TOKEN_ENV}, and that the server is up (GET /healthz). The token comes from \`mfeflow-registry token create\` on the server and is read only from the environment.`;

type Env = Readonly<Record<string, string | undefined>>;

const present = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

/** The server address: `--registry-url`, else `MFEFLOW_REGISTRY_URL`. Undefined means static mode. */
export function serverUrlOf(args: Record<string, unknown>, env: Env): string | undefined {
  return present(text(args, 'registry-url')) ?? present(env[URL_ENV]);
}

const bad = (why: string): MfeflowError =>
  new MfeflowError('E506', `the registry server address ${why}`, { fix: SERVER_FIX });

/**
 * The address as the client uses it: https, or http on a loopback host, with no login, query or
 * fragment, and no trailing slash. A token is sent to this address, so anything else is refused.
 */
export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad('is not a URL; write it like https://registry.example.com');
  }
  if (url.username !== '' || url.password !== '') throw bad('must not contain a login');
  if (url.search !== '' || url.hash !== '') throw bad('must not contain a query or a fragment');
  if (url.protocol === 'http:' && !isLoopbackHttp(url))
    throw bad(
      `uses plain http, which is allowed only on localhost (${url.hostname} is not); use https so the token is not sent in the clear`,
    );
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('must be https');
  let end = url.pathname.length;
  while (end > 0 && url.pathname.charCodeAt(end - 1) === 47) end -= 1;
  return `${url.origin}${url.pathname.slice(0, end)}`;
}

const BY_CODE: Record<string, ErrorCode> = {
  version_immutable: 'E511',
  artifact_missing: 'E509',
  version_missing: 'E509',
  not_deployed: 'E508',
  no_target: 'E508',
  no_rollout: 'E508',
  no_next_step: 'E508',
  no_stable: 'E508',
  unknown_env: 'E508',
  conflict: 'E510',
  rollout_active: 'E510',
  killed: 'E510',
  route_overlap: 'E502',
  not_configured: 'E506',
};

/** The catalogue code for a server error: its own code first, then the HTTP status. Always E5xx. */
export function errorCodeFor(status: number, code: string | undefined): ErrorCode {
  const known = code === undefined ? undefined : BY_CODE[code];
  if (known !== undefined) return known;
  if (status === 404) return 'E508';
  if (status === 409) return 'E510';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'E501';
  return 'E506';
}

export interface ServerFailure {
  code: string;
  message: string;
  failures?: { code: string; message?: string; route?: string }[];
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ServerFailure,
  ) {
    super(failure.message);
    this.name = 'ServerError';
  }
}

export interface Reply {
  status: number;
  body: unknown;
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function failureEntry(f: Record<string, unknown>): NonNullable<ServerFailure['failures']>[number] {
  const entry: NonNullable<ServerFailure['failures']>[number] = {
    code: typeof f.code === 'string' ? f.code : '',
  };
  if (typeof f.message === 'string') entry.message = f.message;
  if (typeof f.route === 'string') entry.route = f.route;
  return entry;
}

function failureOf(body: unknown, status: number): ServerFailure {
  const error = isObj(body) ? body.error : undefined;
  if (isObj(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    const failures = Array.isArray(error.failures)
      ? error.failures.filter(isObj).map((f) => failureEntry(f))
      : undefined;
    return {
      code: error.code,
      message: error.message,
      ...(failures === undefined ? {} : { failures }),
    };
  }
  return {
    code: 'not_a_registry',
    message: `the address answered HTTP ${String(status)} without a registry error body; check it is a mfeflow registry server`,
  };
}

export class ServerClient {
  constructor(
    readonly url: string,
    private readonly token: string | undefined,
    private readonly doFetch: typeof fetch,
    private readonly secrets: readonly string[],
  ) {}

  /** How the server is named in output: never a credential. */
  get label(): string {
    return `server ${this.url}`;
  }

  /** Text the server sent, with the token taken out, for anything that is printed. */
  scrub(words: string): string {
    return redact(words, this.secrets);
  }

  /** A result document with every string scrubbed. The server's words reach the output through it. */
  scrubAll<T>(value: T): T {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON round trip keeps the shape
    return JSON.parse(this.scrub(JSON.stringify(value))) as T;
  }

  get hasToken(): boolean {
    return this.token !== undefined;
  }

  /** Throws the catalogue error for anything that is not a 2xx reply; `gates_failed` is thrown as a ServerError. */
  async get(route: string, needsToken = false): Promise<unknown> {
    return this.send('GET', route, undefined, needsToken);
  }

  async post(route: string, body: unknown): Promise<unknown> {
    return this.send('POST', route, body, true);
  }

  /** Like `get` but a 404 is `undefined`. */
  async getOptional(route: string): Promise<unknown> {
    try {
      return await this.get(route);
    } catch (error) {
      if (error instanceof ServerError && error.status === 404) return undefined;
      throw error;
    }
  }

  async index(env: string): Promise<RegistryIndex | undefined> {
    const body = await this.getOptional(`/v1/index/${encodeURIComponent(env)}`);
    if (body === undefined) return undefined;
    if (!isObj(body) || !Array.isArray(body.remotes))
      throw this.wrap(
        new ServerError(200, {
          code: 'not_a_registry',
          message: 'the index answer is not a registry index',
        }),
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shape was just checked, entries are the server's own
    return body as unknown as RegistryIndex;
  }

  private async send(
    method: string,
    route: string,
    body: unknown,
    needsToken: boolean,
  ): Promise<unknown> {
    if (needsToken && this.token === undefined)
      throw new MfeflowError('E506', `${TOKEN_ENV} is not set`, {
        fix: `Export ${TOKEN_ENV} with a token from \`mfeflow-registry token create\`. It is never taken as a flag.`,
      });
    let res: Response;
    try {
      res = await this.doFetch(`${this.url}${route}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.token === undefined ? {} : { authorization: `Bearer ${this.token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new MfeflowError(
        'E506',
        `cannot reach ${this.url}: ${redact(messageOf(error), this.secrets)}`,
        { fix: SERVER_FIX },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      parsed = undefined;
    }
    if (res.ok) {
      if (parsed === undefined)
        throw this.wrap(
          new ServerError(res.status, {
            code: 'not_a_registry',
            message: `the address answered HTTP ${String(res.status)} without JSON; check it is a mfeflow registry server`,
          }),
        );
      return parsed;
    }
    throw new ServerError(res.status, failureOf(parsed, res.status));
  }

  /** A server error as the catalogue error that names it, with secrets scrubbed. */
  wrap(error: ServerError): MfeflowError {
    const code = errorCodeFor(error.status, error.failure.code);
    const message = redact(error.failure.message, this.secrets);
    return code === 'E506'
      ? new MfeflowError(code, message, { fix: SERVER_FIX })
      : new MfeflowError(code, message);
  }

  /** Runs a call and turns every failure into a catalogue error, except `gates_failed`, which `onGates` handles. */
  async run<T>(work: () => Promise<T>, onGates?: (failure: ServerFailure) => T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ServerError) {
        if (error.failure.code === 'gates_failed' && onGates !== undefined)
          return onGates(error.failure);
        throw this.wrap(error);
      }
      if (error instanceof MfeflowError) throw error;
      throw new MfeflowError('E506', redact(messageOf(error), this.secrets), { fix: SERVER_FIX });
    }
  }
}

/** The client, or undefined when this run is in static mode. */
export function openServer(rt: Runtime, args: Record<string, unknown>): ServerClient | undefined {
  const raw = serverUrlOf(args, rt.io.env);
  if (raw === undefined) return undefined;
  const token = present(rt.io.env[TOKEN_ENV]);
  return new ServerClient(
    normalizeServerUrl(raw),
    token,
    rt.serverFetch ?? ((url, init) => fetch(url, init)),
    token === undefined ? [] : [token],
  );
}
