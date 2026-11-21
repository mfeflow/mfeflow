/** The global the shell's `<head>` sets to the base path: `/` or `/demo/`. Read by `@mfeflow/runtime` and `@mfeflow/route-factory`. */
export const BASE_PATH_GLOBAL = '__MFE_BASE_PATH__';
/** The global that holds the shell's default registry index URL under a base path. */
export const REGISTRY_URL_GLOBAL = '__MFE_REGISTRY_URL__';

/** The name of the head script that sets both globals. */
export const BASE_SCRIPT_NAME = 'mfeflow:base';

import { registerHeadScript, unregisterHeadScript } from './head-scripts';

const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `demo`, `/demo`, `demo/` and `/demo//` all become `/demo/`; nothing, an empty string and `/` become
 * `/`. A base is a path on the shell's own origin, written as it appears in a URL, so a URL, a query,
 * a fragment, a backslash, a `.`/`..` segment, or a character that would need percent-encoding (a
 * space, `%`, `<`, a non-ASCII letter) throws.
 */
export function normalizeBasePath(input: string | undefined): string {
  const value = (input ?? '').trim();
  if (value === '') return '/';
  if (/[\\?#]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//'))
    throw new Error(
      `mfeflow: basePath "${value}" must be a path such as /demo/, not a URL or a path with ? # or \\`,
    );
  const segments = value.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    throw new Error(`mfeflow: basePath "${value}" must not contain . or .. segments`);
  if (segments.some((segment) => !SEGMENT.test(segment)))
    throw new Error(
      `mfeflow: basePath "${value}" may only use letters, digits and . _ ~ - ! $ & ' ( ) * + , ; = : @ between slashes; a character that needs percent-encoding is not allowed`,
    );
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

/** The base path of a shell build: the `basePath` option, else `MFEFLOW_BASE_PATH`, else `/`. */
export function resolveBasePath(basePath: string | undefined, env: Env): string {
  return normalizeBasePath(basePath ?? env.MFEFLOW_BASE_PATH);
}

/**
 * The registry index URL a build sets on purpose: the `registryUrl` option, else `MFEFLOW_REGISTRY_URL`,
 * else nothing. A value without a leading `/` is under the base (`envs/prod/index.json` becomes
 * `/demo/envs/prod/index.json`); `/x` and `https://...` are used as written.
 */
export function resolveRegistryUrl(
  base: string,
  registryUrl: string | undefined,
  env: Env,
): string | undefined {
  const value = (registryUrl ?? env.MFEFLOW_REGISTRY_URL ?? '').trim();
  if (value === '') return undefined;
  if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `${base}${value}`;
}

/** Where the shell looks for the registry index when nothing says otherwise: `<base>registry/index.json`. */
export function defaultRegistryUrlFor(base: string): string {
  return `${base}registry/index.json`;
}

/** JSON that is safe inside an inline `<script>`: no `</script>`, no line-separator characters. */
function scriptJson(value: string): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/** The inline script that hands the base path and the default registry URL to the page. */
export function baseHeadScript(base: string, registryUrl: string): string {
  return `window.${BASE_PATH_GLOBAL}=${scriptJson(base)};window.${REGISTRY_URL_GLOBAL}=${scriptJson(registryUrl)};`;
}

/**
 * Registers the head script that sets the base globals, or removes it when the build has neither a base
 * nor a registry URL, so a config that is loaded again (dev server restart) never keeps a stale base.
 * Returns the base path.
 */
export function applyBaseHeadScript(
  basePath: string | undefined,
  registryUrl: string | undefined,
  env: Env,
): string {
  const base = resolveBasePath(basePath, env);
  const chosen = resolveRegistryUrl(base, registryUrl, env);
  if (base === '/' && chosen === undefined) unregisterHeadScript(BASE_SCRIPT_NAME);
  else
    registerHeadScript(
      BASE_SCRIPT_NAME,
      baseHeadScript(base, chosen ?? defaultRegistryUrlFor(base)),
    );
  return base;
}
