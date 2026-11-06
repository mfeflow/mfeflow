import type { RsbuildConfig } from '@rsbuild/core';
import { runtimeConfigEnv, runtimeConfigEnvs, runtimeConfigHandler } from '@mfeflow/bundler-shared';

export {
  RUNTIME_CONFIG_URL,
  runtimeConfigEnv,
  runtimeConfigEnvs,
  runtimeConfigHandler,
} from '@mfeflow/bundler-shared';

type ServerSetup = NonNullable<NonNullable<RsbuildConfig['server']>['setup']>;
type ServerSetupFn = Extract<ServerSetup, (...args: never[]) => unknown>;

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
