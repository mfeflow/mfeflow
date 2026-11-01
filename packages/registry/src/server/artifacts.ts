import { ArtifactTooLargeError, type ArtifactSource } from './service';

async function nextChunk(reader: { read(): Promise<unknown> }): Promise<Uint8Array | undefined> {
  const result = await reader.read();
  if (typeof result !== 'object' || result === null) throw new Error('unreadable body');
  if ('done' in result && result.done === true) return undefined;
  if ('value' in result && result.value instanceof Uint8Array) return result.value;
  throw new Error('unreadable body');
}

export interface FetchSourceOptions {
  fetch?: typeof fetch;
  /** Largest file the server will read. */
  maxBytes?: number;
  timeoutMs?: number;
}

/** Reads artifacts over HTTP. Redirects are refused: a manifest URL is checked against the artifact base, and a redirect would escape it. */
export function fetchArtifactSource(options: FetchSourceOptions = {}): ArtifactSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const max = options.maxBytes ?? 8 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 10_000;
  return {
    async get(url, request) {
      const res = await doFetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: { accept: '*/*' },
      });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${String(res.status)}`);
      }
      const limit = Math.min(max, request?.maxBytes ?? max);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > limit) {
        await res.body?.cancel().catch(() => undefined);
        throw new ArtifactTooLargeError(limit);
      }
      if (res.body === null) return new Uint8Array();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- sequential stream reads
        const chunk = await nextChunk(reader);
        if (chunk === undefined) break;
        total += chunk.byteLength;
        if (total > limit) {
          // oxlint-disable-next-line no-await-in-loop -- stop reading at once
          await reader.cancel().catch(() => undefined);
          throw new ArtifactTooLargeError(limit);
        }
        chunks.push(chunk);
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
  };
}
