/** Set in the shell's `<head>` by the bundler preset when the shell is built with a base path. */
export const BASE_PATH_GLOBAL = '__MFE_BASE_PATH__';
/** The shell's default registry index URL under a base path, set next to `BASE_PATH_GLOBAL`. */
export const REGISTRY_URL_GLOBAL = '__MFE_REGISTRY_URL__';

function text(key: string): string | undefined {
  const value: unknown = Reflect.get(globalThis, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The path the shell is served under, with both slashes: `/` at the root of a host, `/demo/` on a project site. */
export function basePath(): string {
  const value = text(BASE_PATH_GLOBAL);
  if (value === undefined) return '/';
  const slashed = value.startsWith('/') ? value : `/${value}`;
  return slashed.endsWith('/') ? slashed : `${slashed}/`;
}

/** A route path under the base: `withBase('/cart')` is `/demo/cart`, and `/cart` at the root. */
export function withBase(path: string): string {
  const base = basePath();
  return base === '/' || !path.startsWith('/') ? path : `${base.slice(0, -1)}${path}`;
}

/** The route path for a URL pathname: `stripBase('/demo/cart')` is `/cart`, and `/demo` is `/`. */
export function stripBase(pathname: string): string {
  const base = basePath();
  if (base === '/') return pathname;
  const bare = base.slice(0, -1);
  if (pathname === bare) return '/';
  return pathname.startsWith(base) ? pathname.slice(bare.length) : pathname;
}

/** The index URL the shell loads without a `registryUrls` config: `/registry/index.json`, or the one the build chose under a base path. */
export function defaultRegistryUrl(): string {
  return text(REGISTRY_URL_GLOBAL) ?? '/registry/index.json';
}

/** The file the shell fetches for its runtime config, under the base. */
export function runtimeConfigUrl(): string {
  return `${basePath()}config/runtime-config.json`;
}
