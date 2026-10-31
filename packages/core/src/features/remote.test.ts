import { describe, expect, it } from 'vitest';
import { rejection } from '../testing.js';
import { fetchRemoteText, type FetchLike, type FetchResponse } from './remote.js';

const registries = { '@acme': 'https://acme.example/{name}.json' };
const encoder = new TextEncoder();

interface Streamed {
  response: FetchResponse;
  pulled: () => number;
  cancelled: () => boolean;
}

/** A response whose body is `chunks`, counting how many were pulled and whether the reader gave up. */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Streamed {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled];
      pulled += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response: FetchResponse = {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body,
    text: () => Promise.reject(new Error('text() must not be used when a body is available')),
  };
  return { response, pulled: () => pulled, cancelled: () => cancelled };
}

const fetching =
  (response: FetchResponse): FetchLike =>
  () =>
    Promise.resolve(response);
const get = (response: FetchResponse) =>
  fetchRemoteText('@acme/segment', registries, fetching(response));

describe('fetchRemoteText size cap', () => {
  it('reads a small body from the stream', async () => {
    const { response } = streamed([encoder.encode('{"a":'), encoder.encode('1}')]);
    expect(await get(response)).toBe('{"a":1}');
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const bytes = encoder.encode('€');
    const { response } = streamed([bytes.slice(0, 1), bytes.slice(1)]);
    expect(await get(response)).toBe('€');
  });

  it('refuses from content-length alone, without reading the body', async () => {
    const { response, pulled, cancelled } = streamed([encoder.encode('x')], {
      'content-length': '2000000',
    });
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
    expect(pulled()).toBeLessThanOrEqual(1);
    expect(cancelled()).toBe(true);
  });

  it('counts bytes, not characters: 400k euro signs are 1.2 MB', async () => {
    const chunk = encoder.encode('€'.repeat(100_000));
    const { response, pulled, cancelled } = streamed(Array.from({ length: 8 }, () => chunk));
    expect('€'.repeat(400_000).length).toBeLessThan(1_000_000);
    const error = await rejection(get(response));
    expect(error.code).toBe('MFEFLOW_E402');
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThanOrEqual(6);
  });

  it('stops reading as soon as the cap is passed, whatever content-length said', async () => {
    const chunk = new Uint8Array(400_000).fill(120);
    const { response, pulled, cancelled } = streamed(
      Array.from({ length: 50 }, () => chunk),
      { 'content-length': '10' },
    );
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThan(10);
  });

  it('accepts a body of exactly the cap', async () => {
    const { response } = streamed([new Uint8Array(1_000_000).fill(32)]);
    expect((await get(response)).length).toBe(1_000_000);
  });

  it('falls back to text() for a response without a body, counting bytes there too', async () => {
    const text = '€'.repeat(400_000);
    const response: FetchResponse = { ok: true, status: 200, text: () => Promise.resolve(text) };
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
  });
});
