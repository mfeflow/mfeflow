import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, validateResult, type FeaturesResult } from '..';
import { removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function emptyFolder(): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

function jsonOf(out: string[]): FeaturesResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as FeaturesResult;
}

describe('mfeflow features', () => {
  it('lists every first-party feature with version, description and how it is chosen', async () => {
    const rt = testRuntime();
    expect(await main(['features', '--cwd', await emptyFolder()], rt)).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toMatch(/core\s+0\.1\.0\s+.*\[always\]/);
    expect(text).toMatch(/lint-oxlint\s+.*\[default\]/);
    expect(text).toMatch(/git-hooks\s+.*\[opt-in\]/);
    expect(text).toContain('mfeflow add @namespace/name');
  });

  it('filters by name or description, ignoring case', async () => {
    const rt = testRuntime();
    await main(['features', 'OXLINT', '--json', '--cwd', await emptyFolder()], rt);
    const result = jsonOf(rt.io.out);
    expect(result.search).toBe('OXLINT');
    expect(result.features.map((f) => f.name)).toEqual(['lint-oxlint']);
    const byDescription = testRuntime();
    await main(['features', 'commitlint', '--json', '--cwd', await emptyFolder()], byDescription);
    expect(jsonOf(byDescription.io.out).features.map((f) => f.name)).toEqual(['git-hooks']);
  });

  it('says when nothing matches, and still exits 0', async () => {
    const rt = testRuntime();
    expect(await main(['features', 'zzz', '--cwd', await emptyFolder()], rt)).toBe(0);
    expect(rt.io.out.join('\n')).toContain('No features match "zzz".');
  });

  it('marks what the project in the working folder already has', async () => {
    const cwd = await emptyFolder();
    await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
    const rt = testRuntime();
    await main(['features', '--json', '--cwd', path.join(cwd, 'app')], rt);
    const installed = Object.fromEntries(
      jsonOf(rt.io.out).features.map((f) => [f.name, f.installed]),
    );
    expect(installed).toEqual({
      core: true,
      tsconfig: true,
      'lint-oxlint': true,
      'url-factory': true,
      'git-hooks': false,
    });
    const outside = testRuntime();
    await main(['features', '--json', '--cwd', cwd], outside);
    expect(jsonOf(outside.io.out).features.every((f) => !f.installed)).toBe(true);
  });
});
