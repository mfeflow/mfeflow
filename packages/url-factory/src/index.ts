type IdChar =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '_';

/** The leading letters, digits and underscores of `S`: where `fillPath` ends a param name. */
type Ident<S extends string, Acc extends string = ''> = S extends `${infer C}${infer Rest}`
  ? C extends IdChar
    ? Ident<Rest, `${Acc}${C}`>
    : Acc
  : Acc;

/**
 * Names of `:params` in a path template, e.g. `'/v1/orders/:orderId/items/:itemId'` gives
 * `'orderId' | 'itemId'`. A name is letters, digits and underscores, as in `fillPath`, so
 * `'/a/:order-id'` has the param `order`.
 */
export type PathParams<P extends string> = string extends P
  ? string
  : P extends `${string}:${infer Rest}`
    ? Exclude<Ident<Rest>, ''> | PathParams<Rest>
    : never;

const PARAM = /:([A-Za-z0-9_]+)/g;

/**
 * Fills the `:params` of a path template with encoded values. Throws for a missing param and for
 * the values `.` and `..`, which would walk out of the path. `scope` and `id` only name the caller in
 * the message.
 */
export function fillPath(
  template: string,
  params: Readonly<Record<string, string | number>> | undefined,
  scope: string,
  id: string,
): string {
  return template.replace(PARAM, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`${scope}: missing param "${name}" for "${id}"`);
    const text = String(value);
    if (text === '.' || text === '..')
      throw new Error(`${scope}: param "${name}" for "${id}" cannot be "${text}"`);
    return encodeURIComponent(text);
  });
}

export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type Query = Readonly<Record<string, QueryValue>>;

export interface Endpoint {
  /** Key into the runtime config's service base URLs, e.g. `orders`. */
  readonly service: string;
  /** Path template relative to the service base, e.g. `/v1/orders/:orderId`. */
  readonly path: string;
}

export type Endpoints = Readonly<Record<string, Endpoint>>;

/** `[options?]` for paths without params, `[options]` with required `params` otherwise. */
export type UrlArgs<P extends string> = [PathParams<P>] extends [never]
  ? [options?: { query?: Query }]
  : [options: { params: Readonly<Record<PathParams<P>, string | number>>; query?: Query }];

export type UrlFactory<E extends Endpoints> = <K extends keyof E & string>(
  key: K,
  ...args: UrlArgs<E[K]['path']>
) => string;

/** Identity helper that keeps the literal path types, so params are checked. */
export function defineEndpoints<const E extends Endpoints>(endpoints: E): E {
  for (const [key, e] of Object.entries(endpoints)) {
    if (!e.path.startsWith('/')) throw new Error(`Endpoint "${key}": path must start with "/"`);
  }
  return endpoints;
}

function appendQuery(url: URL, query: Query | undefined): void {
  if (!query) return;
  for (const [name, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number | boolean)[])
        url.searchParams.append(name, String(item));
    } else {
      url.searchParams.append(name, String(value));
    }
  }
}

/**
 * Builds absolute URLs for `endpoints`. `baseUrl(service)` is called on every
 * call, so it can read runtime config that loads after the factory is created.
 *
 * ```ts
 * const endpoints = defineEndpoints({ getOrder: { service: 'orders', path: '/v1/orders/:orderId' } });
 * const apiUrl = createUrlFactory(endpoints, (s) => getRuntimeConfig().services[s]);
 * apiUrl('getOrder', { params: { orderId: 42 }, query: { expand: 'items' } });
 * ```
 */
export function createUrlFactory<E extends Endpoints>(
  endpoints: E,
  baseUrl: (service: E[keyof E]['service']) => string | undefined,
): UrlFactory<E> {
  return (key, ...args) => {
    const endpoint = endpoints[key];
    if (!endpoint) throw new Error(`url-factory: unknown endpoint "${key}"`);
    const base = baseUrl(endpoint.service);
    if (!base)
      throw new Error(
        `url-factory: no base URL for service "${endpoint.service}" (endpoint "${key}")`,
      );
    const options:
      { params?: Readonly<Record<string, string | number>>; query?: Query } | undefined = args[0];
    const path = fillPath(endpoint.path, options?.params, 'url-factory', key);
    const url = new URL(path.slice(1), base.endsWith('/') ? base : `${base}/`);
    appendQuery(url, options?.query);
    return url.toString();
  };
}
