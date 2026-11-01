import { fillPath } from '@mfeflow/url-factory';
import type {
  LinkArgs,
  LinkId,
  RouteSet,
  RouteSets,
  RouteTable,
  SearchValue,
  TemplateOf,
} from './types';

export type {
  LinkArgs,
  LinkId,
  LinkOptions,
  OptionalSearch,
  ParamValue,
  PathParams,
  RequiredSearch,
  RouteSet,
  RouteSets,
  RouteTable,
  SearchValue,
  TemplateOf,
} from './types';

/** The loose form of `LinkOptions` the implementation reads; the typed form is on `Links`. */
interface Loose {
  params?: Readonly<Record<string, string | number>> | undefined;
  search?: Readonly<Record<string, SearchValue | undefined>> | undefined;
  hash?: string | undefined;
}

const MOUNT = /^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*)?$/;

/**
 * One remote's routes. `mount` is where the shell serves the remote (`'/catalog'`, or `'/'` for a
 * remote at the root); each route is a path under it, with search params after a `?`:
 *
 * ```ts
 * export const catalogRoutes = defineRoutes('/catalog', {
 *   home: '/',
 *   product: '/products/:sku',
 *   search: '/search?q&page?', // q is required, page is optional
 * });
 * ```
 */
export function defineRoutes<const R extends RouteTable>(mount: string, routes: R): RouteSet<R> {
  if (!MOUNT.test(mount))
    throw new Error(
      `route-factory: mount "${mount}" must start with "/" and have no trailing "/", "?" or ":"`,
    );
  for (const [name, template] of Object.entries(routes)) {
    if (!template.startsWith('/'))
      throw new Error(`route-factory: route "${name}" must start with "/" (got "${template}")`);
  }
  return { mount: mount === '/' ? '' : mount, routes };
}

export interface LinkConfig {
  /**
   * Where the shell is served: `''` (default) at the origin's root, `'/app'` under a path, or a
   * full URL for links that leave the page. A function is read on every call, so it can come from
   * runtime config that loads after the links are created.
   */
  base?: string | (() => string);
}

export interface Links<S extends RouteSets> {
  /** The URL for a route, under the shell's base: `/app/catalog/products/42?ref=home#reviews`. */
  href: <Id extends LinkId<S>>(id: Id, ...args: LinkArgs<TemplateOf<S, Id>>) => string;
  /** The same without the base, for a router that has its own `basename`. */
  path: <Id extends LinkId<S>>(id: Id, ...args: LinkArgs<TemplateOf<S, Id>>) => string;
}

function trimEnd(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function query(
  search: Readonly<Record<string, SearchValue | undefined>> | undefined,
  allowed: readonly string[],
  id: string,
): string {
  const entries = Object.entries(search ?? {}).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    if (!allowed.includes(key))
      throw new Error(`route-factory: "${key}" is not a search param of "${id}"`);
  }
  if (entries.length === 0) return '';
  const out = new URLSearchParams();
  for (const [key, value] of entries) out.append(key, String(value));
  return `?${out.toString()}`;
}

function split(template: string): { path: string; search: { name: string; required: boolean }[] } {
  const at = template.indexOf('?');
  if (at === -1) return { path: template, search: [] };
  return {
    path: template.slice(0, at),
    search: template
      .slice(at + 1)
      .split('&')
      .filter((part) => part !== '')
      .map((part) => ({ name: part.replace(/\?$/, ''), required: !part.endsWith('?') })),
  };
}

/**
 * Typed links across remotes. The id is `<remote>.<route>`; a missing param, a missing required
 * search param or an unknown route fails typecheck, and throws if types were bypassed.
 *
 * ```ts
 * const links = createLinks({ catalog: catalogRoutes, cart: cartRoutes }, { base: '/app' });
 * links.href('catalog.product', { params: { sku: 'A1' }, search: { ref: 'home' } });
 * ```
 */
export function createLinks<const S extends RouteSets>(sets: S, config: LinkConfig = {}): Links<S> {
  const build = (withBase: boolean) => (id: string, options?: Loose) => {
    const dot = id.indexOf('.');
    const set = sets[id.slice(0, dot)];
    const template = set?.routes[id.slice(dot + 1)];
    if (set === undefined || template === undefined)
      throw new Error(`route-factory: unknown route "${id}"`);
    const { path, search } = split(template);
    const base = withBase
      ? trimEnd(typeof config.base === 'function' ? config.base() : (config.base ?? ''))
      : '';
    const inner = fillPath(path, options?.params, 'route-factory', id);
    const joined = `${base}${set.mount}${inner === '/' && set.mount !== '' ? '' : inner}`;
    for (const { name, required } of search) {
      if (required && options?.search?.[name] === undefined)
        throw new Error(`route-factory: missing search param "${name}" for "${id}"`);
    }
    const hash = options?.hash ? `#${options.hash.replace(/^#/, '')}` : '';
    return `${joined === '' ? '/' : joined}${query(
      options?.search,
      search.map((s) => s.name),
      id,
    )}${hash}`;
  };
  // The typed signatures are in `Links`; the implementation takes the loose form of the same call.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return { href: build(true), path: build(false) } as Links<S>;
}

/** One line of the shell's route table. */
export interface ShellRoute {
  remote: string;
  /** Where the shell serves the remote, e.g. `/catalog`. */
  mount: string;
  /** The same as a wildcard pattern for a router or `mfeflow.app.json`, e.g. `/catalog/*`. */
  pattern: string;
}

/**
 * What the shell needs to route to each remote, from the same definitions the links come from:
 * add `pattern` to a router or to `mfeflow.app.json` `routes`, and `mount` to a hand-written route table.
 */
export function shellRoutes(sets: RouteSets): ShellRoute[] {
  return Object.entries(sets).map(([remote, set]) => ({
    remote,
    mount: set.mount === '' ? '/' : set.mount,
    pattern: `${set.mount}/*`,
  }));
}
