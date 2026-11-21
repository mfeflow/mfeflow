/** The global the shell's `<head>` sets to the base path: `/` or `/demo/`. Read by `@mfeflow/runtime` and `@mfeflow/route-factory`. */
export const BASE_PATH_GLOBAL = '__MFE_BASE_PATH__';
/** The global that holds the shell's default registry index URL under a base path. */
export const REGISTRY_URL_GLOBAL = '__MFE_REGISTRY_URL__';

/** The name of the head script that sets both globals. */
export const BASE_SCRIPT_NAME = 'mfeflow:base';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `demo`, `/demo`, `demo/` and `/demo//` all become `/demo/`; nothing, an empty string and `/` become
 * `/`. A base is a path on the shell's own origin, so a URL, a query, a fragment, a backslash or a
 * `.`/`..` segment throws.
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
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

/** The base path of a shell build: the `basePath` option, else `MFEFLOW_BASE_PATH`, else `/`. */
export function resolveBasePath(basePath: string | undefined, env: Env): string {
  return normalizeBasePath(basePath ?? env.MFEFLOW_BASE_PATH);
}

/**
 * Where the shell looks for the registry index under a base path: `<base>envs/<env>/index.json`, the
 * file `mfeflow deploy` writes, when the build names its environment with `MFE_ENV`; otherwise
 * `<base>registry/index.json`.
 */
export function defaultRegistryUrlFor(base: string, env: Env): string {
  const name = env.MFE_ENV;
  return name === undefined || name === ''
    ? `${base}registry/index.json`
    : `${base}envs/${name}/index.json`;
}

/** The inline script that hands the base path and the default registry URL to the page. */
export function baseHeadScript(base: string, env: Env): string {
  return `window.${BASE_PATH_GLOBAL}=${JSON.stringify(base)};window.${REGISTRY_URL_GLOBAL}=${JSON.stringify(defaultRegistryUrlFor(base, env))};`;
}
