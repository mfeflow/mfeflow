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
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** Generates a project with `remotes`, then runs the shell's `rsbuild dev` config from apps/shell. */
async function devRegistryOf(remotes: string[]): Promise<{ root: string; script: string }> {
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
  const url = `${path.join(shell, 'rsbuild.config.ts')}?${String(Date.now())}${remotes.join()}`;
  const loaded = (await import(/* @vite-ignore */ url)) as {
    default: (env: { command: string }) => ShellConfig;
  };
  const config = loaded.default({ command: 'dev' });
  return { root, script: config.html.tags[0]?.children ?? '' };
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
});
