import path from 'node:path';
import type { ReadFile } from '../plan';

/**
 * An in-memory folder for tests: `files` is keyed by path relative to `root`
 * with `/` separators, so the same table works on every OS.
 */
export function memoryFs(
  root: string,
  files: Record<string, string>,
): { read: ReadFile; listDirs: (dir: string) => Promise<string[]> } {
  const key = (file: string): string => path.relative(root, file).split(path.sep).join('/');
  return {
    read: (file) => Promise.resolve(files[key(file)]),
    listDirs: (dir) => {
      const prefix = key(dir) === '' ? '' : `${key(dir)}/`;
      const names = new Set<string>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length).split('/');
        if (rest.length > 1 && rest[0]) names.add(rest[0]);
      }
      return Promise.resolve([...names]);
    },
  };
}
