import type { ArtifactSource } from './service';

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
    async get(url) {
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
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > max) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`larger than ${String(max)} bytes`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > max) throw new Error(`larger than ${String(max)} bytes`);
      return bytes;
    },
  };
}
