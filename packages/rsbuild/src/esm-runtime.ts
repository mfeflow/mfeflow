import fs from 'node:fs';
import type { RsbuildPlugin } from '@rsbuild/core';

const CJS_FILE = /\.cjs$/;
const MF_DIST = /[\\/]@module-federation[\\/][^\\/]+[\\/]dist[\\/]/;

/** True for a CommonJS build inside an `@module-federation/*` package's `dist`. */
export function isMfCjs(file: string): boolean {
  return CJS_FILE.test(file) && MF_DIST.test(file);
}

/**
 * The ESM twin of a Module Federation `.cjs` file: the same name ending in
 * `.js` or `.mjs` in the same directory. Throws if there is none, so a new
 * Module Federation release that drops the twin fails the build instead of
 * quietly shipping the CommonJS runtime again.
 */
export function esmTwin(file: string, exists: (f: string) => boolean = fs.existsSync): string {
  const twin = [file.replace(/\.cjs$/, '.js'), file.replace(/\.cjs$/, '.mjs')].find((f) =>
    exists(f),
  );
  if (twin === undefined) {
    throw new Error(
      `@mfeflow/rsbuild: no ESM build next to ${file}. Set esmRuntime: false to keep the CommonJS runtime.`,
    );
  }
  return twin;
}

/**
 * Rspack resolves the Module Federation runtime with `require.resolve`, which
 * bundles the CommonJS builds of sdk, runtime-core and bundler-runtime. Nothing
 * in those tree-shakes (spike: shell 34.9 → 29.4 KB gzip, remote entry 13.7 →
 * 7.7 KB). This plugin points them at their ESM twins.
 */
export function pluginMfEsmRuntime(): RsbuildPlugin {
  return {
    name: 'mfeflow:mf-esm-runtime',
    setup(api) {
      api.modifyRspackConfig((config, { rspack }) => {
        config.plugins ??= [];
        config.plugins.push(
          new rspack.NormalModuleReplacementPlugin(CJS_FILE, (data) => {
            const created = data.createData;
            if (created?.resource !== undefined && isMfCjs(created.resource)) {
              const cjs = created.resource;
              const esm = esmTwin(cjs);
              // The loader-prefixed request and the user request name the module, so they move with the resource.
              for (const key of ['request', 'userRequest', 'resource'] as const) {
                const value = created[key];
                if (typeof value === 'string') created[key] = value.replace(cjs, esm);
              }
            } else if (isMfCjs(data.request)) {
              data.request = esmTwin(data.request);
            }
          }),
        );
      });
    },
  };
}
