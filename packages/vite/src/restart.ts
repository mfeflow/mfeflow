import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/** Whether `file` is `target` or inside it (`target` is a file or a folder). */
export function isUnder(file: string, target: string): boolean {
  const rel = path.relative(path.resolve(target), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Restarts the dev server when a file at or under one of `paths` is added, changed or removed, so the
 * config runs again and reads it fresh: the Vite counterpart of Rsbuild's
 * `dev.watchFiles: { type: 'restart' }`. The shell uses it for the dev registry.
 */
export function pluginRestartOn(paths: string | readonly string[]): Plugin {
  const targets = (typeof paths === 'string' ? [paths] : [...paths]).map((p) => path.resolve(p));
  return {
    name: 'mfeflow:restart-on',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.watcher.add(targets);
      const restart = (file: string) => {
        if (targets.some((t) => isUnder(file, t))) void server.restart();
      };
      server.watcher.on('add', restart);
      server.watcher.on('change', restart);
      server.watcher.on('unlink', restart);
    },
  };
}
