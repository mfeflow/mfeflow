/** Names of `:params` in a path template, e.g. `'/v1/orders/:orderId/items/:itemId'` → `'orderId' | 'itemId'`. */
export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;

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
    const path = endpoint.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
      const value = options?.params?.[name];
      if (value === undefined) throw new Error(`url-factory: missing param "${name}" for "${key}"`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(path.slice(1), base.endsWith('/') ? base : `${base}/`);
    appendQuery(url, options?.query);
    return url.toString();
  };
}
