import { describe, expect, it } from 'vitest';
import { fetchArtifactSource } from './artifacts';
import { ArtifactTooLargeError } from './service';

const source = (response: Response | Error, maxBytes?: number) =>
  fetchArtifactSource({
    ...(maxBytes === undefined ? {} : { maxBytes }),
    fetch: () => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)),
  });

describe('fetchArtifactSource', () => {
  it('returns the bytes', async () => {
    const bytes = await source(new Response('hello')).get('https://cdn.example.com/a');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('returns undefined for 404 and throws for other statuses', async () => {
    expect(
      await source(new Response('', { status: 404 })).get('https://cdn.example.com/a'),
    ).toBeUndefined();
    await expect(
      source(new Response('', { status: 503 })).get('https://cdn.example.com/a'),
    ).rejects.toThrow('HTTP 503');
  });

  it('refuses a file over the cap, declared or not', async () => {
    await expect(
      source(new Response('x', { headers: { 'content-length': '999999' } }), 100).get(
        'https://cdn.example.com/a',
      ),
    ).rejects.toThrow(/larger than 100 bytes/);
    await expect(
      source(new Response('y'.repeat(200)), 100).get('https://cdn.example.com/a'),
    ).rejects.toThrow(/larger than 100 bytes/);
  });

  it('does not follow redirects and bounds the wait', async () => {
    let seen: RequestInit | undefined;
    const reader = fetchArtifactSource({
      fetch: (_url, init) => {
        seen = init;
        return Promise.resolve(new Response('ok'));
      },
    });
    await reader.get('https://cdn.example.com/a');
    expect(seen?.redirect).toBe('error');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    await expect(
      source(new TypeError('fetch failed')).get('https://cdn.example.com/a'),
    ).rejects.toThrow('fetch failed');
  });

  it('reads an empty body', async () => {
    const bytes = await source(new Response(null, { status: 200 })).get(
      'https://cdn.example.com/a',
    );
    expect(bytes?.byteLength).toBe(0);
  });

  it('aborts a chunked body with no content-length once it passes the cap', async () => {
    let cancelled = false;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new Uint8Array(64));
        if (sent > 1000) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      source(new Response(body), 200).get('https://cdn.example.com/a'),
    ).rejects.toBeInstanceOf(ArtifactTooLargeError);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(20);
  });

  it('honours a smaller per-request cap', async () => {
    await expect(
      source(new Response('y'.repeat(50))).get('https://cdn.example.com/a', { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });
});
