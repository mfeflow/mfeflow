export type HttpErrorKind = 'status' | 'network' | 'timeout' | 'parse' | 'auth';

export interface HttpErrorInit {
  kind: HttpErrorKind;
  method: string;
  /** The endpoint key, for example `getOrder`. */
  endpoint: string;
  status?: number | undefined;
  body?: unknown;
  headers?: Headers | undefined;
  attempts: number;
  cause?: unknown;
}

const WHAT: Record<HttpErrorKind, (init: HttpErrorInit, text: string) => string> = {
  status: (init, text) => `answered ${String(init.status ?? 0)}${text === '' ? '' : ` ${text}`}`,
  network: () => 'could not reach the server',
  timeout: () => 'timed out',
  auth: () => 'could not get a token',
  parse: (init) => `answered ${String(init.status ?? 0)} with a body that is not valid JSON`,
};

/**
 * A request that failed. The message names the method, the endpoint key and what happened, and
 * nothing else: no URL (it can hold ids or emails) and no body. Read `status` and `body` to
 * handle a failure, and decide yourself what to log.
 */
export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly method: string;
  readonly endpoint: string;
  /** The HTTP status; undefined when no response arrived. */
  readonly status: number | undefined;
  /** The response body: parsed when it was JSON, otherwise text cut to 4096 characters. */
  readonly body: unknown;
  readonly headers: Headers | undefined;
  /** How many times the request was sent. */
  readonly attempts: number;

  constructor(init: HttpErrorInit, statusText = '') {
    super(
      `${init.method} ${init.endpoint} ${WHAT[init.kind](init, statusText)}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = 'HttpError';
    this.kind = init.kind;
    this.method = init.method;
    this.endpoint = init.endpoint;
    this.status = init.status;
    this.body = init.body;
    this.headers = init.headers;
    this.attempts = init.attempts;
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
