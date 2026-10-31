import { describe, expect, it } from 'vitest';
import type { FetchLike, FetchResponse } from '@mfeflow/core';
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

  describe('over https', () => {
    const encoder = new TextEncoder();
    const answer = (init: Partial<FetchResponse>): FetchResponse => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error('text() must not be used when a body is available')),
      ...init,
    });
    const header =
      (headers: Record<string, string>) =>
      (name: string): string | null =>
        headers[name.toLowerCase()] ?? null;

    /** Replies in order, remembering what was asked for and how. */
    const script = (...replies: FetchResponse[]) => {
      const asked: { url: string; redirect: unknown }[] = [];
      const fetch: FetchLike = (url, init) => {
        asked.push({ url, redirect: init?.redirect });
        const reply = replies[asked.length - 1];
        return reply ? Promise.resolve(reply) : Promise.reject(new Error('unexpected request'));
      };
      return { fetch, asked };
    };
    const load = (url: string, fetch: FetchLike) => loadPreset(url, { cwd: '/', fetch });

    it('stops reading a body that grows past the cap, without downloading it all', async () => {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(encoder.encode('x'.repeat(40_000)));
        },
      });
      const { fetch } = script(answer({ body: stream }));
      expect((await failure(load('https://x.dev/p', fetch))).message).toContain('100 KB');
      expect(pulled).toBeLessThan(10);
    });

    it('refuses from content-length alone', async () => {
      let bodyRead = false;
      const { fetch } = script(
        answer({
          headers: { get: header({ 'content-length': '5000000' }) },
          text: () => {
            bodyRead = true;
            return Promise.resolve('{}');
          },
        }),
      );
      expect((await failure(load('https://x.dev/p', fetch))).message).toContain('100 KB');
      expect(bodyRead).toBe(false);
    });

    it('reads a streamed body that fits', async () => {
      const { fetch } = script(
        answer({
          body: new Blob(['{"scope":"@s"}']).stream(),
        }),
      );
      expect((await load('https://x.dev/p', fetch)).scope).toBe('@s');
    });

    it('follows a redirect that stays on https, asking for it by hand', async () => {
      const { fetch, asked } = script(
        answer({ ok: false, status: 302, headers: { get: header({ location: '/final.json' }) } }),
        answer({ body: new Blob(['{"scope":"@moved"}']).stream() }),
      );
      expect((await load('https://x.dev/p', fetch)).scope).toBe('@moved');
      expect(asked).toEqual([
        { url: 'https://x.dev/p', redirect: 'manual' },
        { url: 'https://x.dev/final.json', redirect: 'manual' },
      ]);
    });

    it('refuses a redirect to http, and never asks that address', async () => {
      const { fetch, asked } = script(
        answer({
          ok: false,
          status: 301,
          headers: { get: header({ location: 'http://evil.example/p.json' }) },
        }),
      );
      const error = await failure(load('https://x.dev/p', fetch));
      expect(error.code).toBe('MFEFLOW_E109');
      expect(error.message).toContain('not https');
      expect(asked).toHaveLength(1);
    });

    it('refuses a redirect with no address, and one that never ends', async () => {
      const none = script(answer({ ok: false, status: 302, headers: { get: () => null } }));
      expect((await failure(load('https://x.dev/p', none.fetch))).message).toContain('no address');
      const hop = answer({
        ok: false,
        status: 302,
        headers: { get: header({ location: 'https://x.dev/again' }) },
      });
      const loop = script(hop, hop, hop, hop, hop, hop, hop);
      expect((await failure(load('https://x.dev/p', loop.fetch))).message).toContain('too many');
    });

    it('refuses an answer that ended up off https even if the fetch followed on its own', async () => {
      const { fetch } = script(answer({ url: 'http://evil.example/p.json', body: null }));
      expect((await failure(load('https://x.dev/p', fetch))).message).toContain('not https');
    });
  });
});
