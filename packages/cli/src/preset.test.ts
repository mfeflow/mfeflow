import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@mfeflow/core';
import { loadPreset, parsePreset } from './preset';
import { failure, thrown } from './testing';

const noNetwork: FetchLike = () => Promise.reject(new Error('offline'));
const body =
  (text: string, ok = true, status = 200): FetchLike =>
  () =>
    Promise.resolve({ ok, status, text: () => Promise.resolve(text) });

describe('parsePreset', () => {
  it('keeps the options init understands', () => {
    expect(
      parsePreset('p', {
        $schema: 'x',
        scope: '@acme',
        remotes: ['a'],
        features: ['git-hooks'],
        packageManager: 'pnpm',
        topology: 'monorepo',
        options: { 'git-hooks': { x: true } },
      }),
    ).toEqual({
      scope: '@acme',
      remotes: ['a'],
      features: ['git-hooks'],
      packageManager: 'pnpm',
      topology: 'monorepo',
      options: { 'git-hooks': { x: true } },
    });
  });

  it.each([
    ['an array', []],
    ['an unknown key', { remote: ['a'] }],
    ['a non-text scope', { scope: 1 }],
    ['a remotes list with a number', { remotes: ['a', 2] }],
    ['features that are not a list', { features: 'a' }],
    ['options that are not an object', { options: [] }],
    ['options for one feature that are not an object', { options: { a: 1 } }],
  ])('rejects %s with E109', (_name, value) => {
    expect(thrown(() => parsePreset('p', value)).code).toBe('MFEFLOW_E109');
  });
});

describe('loadPreset', () => {
  const read = (text: string) => () => Promise.resolve(text);

  it('reads a file relative to the working folder', async () => {
    const seen: string[] = [];
    const preset = await loadPreset('stack.json', {
      cwd: '/work',
      fetch: noNetwork,
      readFile: (file) => {
        seen.push(file);
        return Promise.resolve('{"scope":"@a"}');
      },
    });
    expect(preset.scope).toBe('@a');
    expect(seen[0]).toMatch(/work.stack\.json$/);
  });

  it('reads an https URL', async () => {
    const preset = await loadPreset('https://x.dev/p.json', {
      cwd: '/',
      fetch: body('{"remotes":["a","b"]}'),
    });
    expect(preset.remotes).toEqual(['a', 'b']);
  });

  it('refuses plain http without fetching', async () => {
    const error = await failure(loadPreset('http://x.dev/p.json', { cwd: '/', fetch: noNetwork }));
    expect(error.message).toContain('must be https');
  });

  it('reports a missing file, a failed request, a bad status, a big body and bad JSON as E109', async () => {
    const sources = (fetch: FetchLike, text?: string) => ({
      cwd: '/',
      fetch,
      readFile: text === undefined ? () => Promise.reject(new Error('ENOENT')) : read(text),
    });
    expect((await failure(loadPreset('nope.json', sources(noNetwork)))).code).toBe('MFEFLOW_E109');
    expect((await failure(loadPreset('https://x.dev/p', sources(noNetwork)))).message).toContain(
      'offline',
    );
    expect(
      (await failure(loadPreset('https://x.dev/p', sources(body('', false, 404))))).message,
    ).toContain('404');
    expect(
      (await failure(loadPreset('https://x.dev/p', sources(body('x'.repeat(200_000)))))).message,
    ).toContain('100 KB');
    expect((await failure(loadPreset('f.json', sources(noNetwork, '{oops')))).message).toContain(
      'not valid JSON',
    );
  });
});
