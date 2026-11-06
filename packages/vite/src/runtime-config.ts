import type { Plugin } from 'vite';
import { runtimeConfigEnv, runtimeConfigEnvs, runtimeConfigHandler } from '@mfeflow/bundler-shared';

/**
 * Serves the chosen env's `public/config/runtime-config.<env>.json` at `/config/runtime-config.json`
 * in the dev and preview servers, for a shell that has such files; a deployed build gets the same file
 * copied there by the deploy step. `MFE_ENV` picks the env, default `dev`.
 */
export function pluginRuntimeConfig(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Plugin {
  const handler =
    runtimeConfigEnvs(cwd).length === 0
      ? undefined
      : runtimeConfigHandler(cwd, runtimeConfigEnv(env));
  return {
    name: 'mfeflow:runtime-config',
    configureServer(server) {
      if (handler) server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      if (handler) server.middlewares.use(handler);
    },
  };
}
