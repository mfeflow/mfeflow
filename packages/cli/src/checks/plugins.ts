import fs from 'node:fs/promises';
import path from 'node:path';
import { finding, type Check, type Finding } from '../findings';
import { readText, type AppView, type ProjectView } from '../inspect';
import { packageNameOf, SINGLETON_PACKAGES } from '../singletons';

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

function withoutComments(code: string): string {
  return code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Module specifiers a source file imports, requires or dynamically imports. */
export function importsOf(code: string): string[] {
  const clean = withoutComments(code);
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of clean.matchAll(pattern)) found.add(m[1] ?? '');
  return [...found];
}

/** Runtime plugin files of an app: the ones its rsbuild config lists, and `runtime-plugin*` files under src. */
async function pluginFiles(app: AppView): Promise<string[]> {
  const found = new Set<string>();
  const config = await readText(path.join(app.dir, 'rsbuild.config.ts'));
  const listed =
    config === undefined ? null : /runtimePlugins\s*:\s*\[([^\]]*)\]/.exec(withoutComments(config));
  for (const m of (listed?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)) {
    const spec = m[1] ?? '';
    if (spec.startsWith('.')) found.add(path.resolve(app.dir, spec));
  }
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // oxlint-disable-next-line no-await-in-loop -- a small tree, one folder at a time
      if (entry.isDirectory()) await walk(full);
      else if (SOURCE.test(entry.name) && /runtime-plugin/.test(path.relative(app.dir, full)))
        found.add(full);
    }
  };
  await walk(path.join(app.dir, 'src'));
  return [...found];
}

async function resolveFile(base: string): Promise<string | undefined> {
  for (const ext of EXTENSIONS) {
    // oxlint-disable-next-line no-await-in-loop -- tries a few names in order
    if ((await readText(base + ext)) !== undefined) return base + ext;
  }
  return undefined;
}

export const runtimePlugins: Check = {
  id: 'plugins.imports',
  title: 'runtime plugins import no shared modules',
  async run(view: ProjectView) {
    const shared = new Set([
      ...SINGLETON_PACKAGES,
      ...view.workspace
        .filter((p) => !view.apps.some((a) => a.dir === p.dir))
        .flatMap((p) => (p.pkg.name ? [p.pkg.name] : [])),
    ]);
    const out: Finding[] = [];
    for (const app of view.apps.filter((a) => a.present)) {
      // oxlint-disable-next-line no-await-in-loop -- a few apps
      const queue = await pluginFiles(app);
      const seen = new Set<string>();
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        if (seen.has(file)) continue;
        seen.add(file);
        // oxlint-disable-next-line no-await-in-loop -- follows relative imports one file at a time
        const code = await readText(file);
        if (code === undefined) continue;
        for (const spec of importsOf(code)) {
          if (spec.startsWith('.')) {
            // oxlint-disable-next-line no-await-in-loop -- as above
            const next = await resolveFile(path.resolve(path.dirname(file), spec));
            if (next !== undefined) queue.push(next);
          } else if (!spec.startsWith('node:') && shared.has(packageNameOf(spec))) {
            const rel = path.relative(view.root, file).split(path.sep).join('/');
            out.push(
              finding('plugins.imports', 'E303', `${rel} imports ${spec}`, {
                app: app.name,
                path: rel,
              }),
            );
          }
        }
      }
    }
    return { findings: out };
  },
};
