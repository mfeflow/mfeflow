import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '.';
import { removeDir, tempDir, testRuntime } from './testing';

// The generated shell config is plain TypeScript; its two imports are replaced so it runs here.
vi.mock('@rsbuild/core', () => ({
  defineConfig: (config: unknown) => config,
  mergeRsbuildConfig: (_base: unknown, extra: unknown) => extra,
}));
vi.mock('@mfeflow/rsbuild', () => ({ createShellConfig: () => ({}) }));

interface ShellConfig {
  html: { tags: { children: string }[] };
  dev: { watchFiles: { paths: string; type: string } };
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** Generates a project with `remotes`, then runs the shell's `rsbuild dev` config from apps/shell. */
async function devRegistryOf(
  remotes: string[],
  generated?: (root: string) => Promise<string>,
): Promise<{ root: string; script: string; config: ShellConfig }> {
  const cwd = await tempDir();
  dirs.push(cwd);
  await fs.writeFile(path.join(cwd, 'preset.json'), JSON.stringify({ remotes }));
  const code = await main(
    ['init', 'app', '--yes', '--no-install', '--preset', 'preset.json', '--cwd', cwd],
    testRuntime(),
  );
  expect(code).toBe(0);
  const root = path.join(cwd, 'app');
  const shell = path.join(root, 'apps/shell');
  vi.spyOn(process, 'cwd').mockReturnValue(shell);
  // The query keeps each run's copy of the config out of the module cache.
  const url = `${path.join(shell, 'rsbuild.config.ts')}?${String(Date.now())}${remotes.join()}${generated ? 'g' : ''}`;
  const file = generated && (await generated(root));
  if (file) vi.stubEnv('MFEFLOW_DEV_REGISTRY', file);
  const loaded = (await import(/* @vite-ignore */ url)) as {
    default: (env: { command: string }) => ShellConfig;
  };
  const config = loaded.default({ command: 'dev' });
  return { root, script: config.html.tags[0]?.children ?? '', config };
}

describe('the generated shell config', () => {
  it('inlines the dev registry of a project with no remotes', async () => {
    const { root, script } = await devRegistryOf([]);
    expect(script).toBe('window.__MFE_REGISTRY__={"remotes":[]}');
    expect(await fs.readdir(path.join(root, 'registry/envs/dev'))).toEqual(['.gitkeep']);
  });

  it('inlines each remote of a project that has some', async () => {
    const { script } = await devRegistryOf(['cart']);
    expect(script).toContain('"name":"cart"');
    expect(script).toContain('http://localhost:4311/mf-manifest.json');
  });

  it('watches the registry folder, and restarts the dev server when it changes', async () => {
    const { root, config } = await devRegistryOf(['cart']);
    expect(config.dev.watchFiles).toEqual({
      paths: path.join(root, 'registry/envs/dev'),
      type: 'restart',
    });
  });

  it('reads the registry mfeflow dev generated, and watches that file instead', async () => {
    const file = path.join(await tempDir(), 'dev-registry.json');
    dirs.push(path.dirname(file));
    const index = {
      remotes: [
        { name: 'checkout', entry: 'http://localhost:3001/mf-manifest.json', version: 'override' },
      ],
    };
    const { script, config } = await devRegistryOf(['cart'], async () => {
      await fs.writeFile(file, JSON.stringify(index));
      return file;
    });
    expect(script).toBe(`window.__MFE_REGISTRY__=${JSON.stringify(index)}`);
    expect(script).not.toContain('"cart"');
    expect(config.dev.watchFiles).toEqual({ paths: file, type: 'restart' });
  });
});
