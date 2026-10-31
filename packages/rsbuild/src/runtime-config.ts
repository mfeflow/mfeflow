import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { RsbuildConfig } from '@rsbuild/core';

type ServerSetup = NonNullable<NonNullable<RsbuildConfig['server']>['setup']>;
type ServerSetupFn = Extract<ServerSetup, (...args: never[]) => unknown>;

/** Where the shell fetches its runtime config from. */
export const RUNTIME_CONFIG_URL = '/config/runtime-config.json';

const ENV_NAME = /^[a-z0-9-]+$/;
const ENV_FILE = /^runtime-config\.([a-z0-9-]+)\.json$/;

/** The environment whose runtime config the dev and preview servers answer with: `MFE_ENV`, default `dev`. */
export function runtimeConfigEnv(env: Readonly<Record<string, string | undefined>>): string {
  const name = env.MFE_ENV === undefined || env.MFE_ENV === '' ? 'dev' : env.MFE_ENV;
  if (!ENV_NAME.test(name)) {
    throw new Error(
      `@mfeflow/rsbuild: MFE_ENV="${name}" is not an environment name (lowercase letters, digits, -)`,
    );
  }
  return name;
}

/** The `<env>` of every `public/config/runtime-config.<env>.json`, sorted. */
export function runtimeConfigEnvs(cwd: string): string[] {
  try {
    return fs
      .readdirSync(path.join(cwd, 'public', 'config'))
      .flatMap((name) => ENV_FILE.exec(name)?.[1] ?? [])
      .toSorted((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Answers `/config/runtime-config.json` with `runtime-config.<env>.json`, read on every request so an
 * edit shows on reload. A missing file for the chosen env is a 404 that says which envs exist.
 */
export function runtimeConfigHandler(cwd: string, env: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== RUNTIME_CONFIG_URL || (req.method !== 'GET' && req.method !== 'HEAD')) {
      next();
      return;
    }
    const file = path.join(cwd, 'public', 'config', `runtime-config.${env}.json`);
    let body: string;
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch {
      const found = runtimeConfigEnvs(cwd).join(', ');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`MFE_ENV=${env} has no public/config/runtime-config.${env}.json (found: ${found})`);
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/**
 * The `server.setup` for a shell with `public/config/runtime-config.<env>.json` files, or undefined
 * without them. It serves the chosen env's file at `/config/runtime-config.json` in the dev and
 * preview servers; a deployed build gets the same file copied there by the deploy step.
 */
export function runtimeConfigSetup(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): ServerSetupFn | undefined {
  if (runtimeConfigEnvs(cwd).length === 0) return undefined;
  const handler = runtimeConfigHandler(cwd, runtimeConfigEnv(env));
  return ({ server }) => {
    server.middlewares.use(handler);
  };
}
