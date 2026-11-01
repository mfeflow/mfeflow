import {
  assertSafeKey,
  HostError,
  PreconditionFailedError,
  toBytes,
  type ObjectInfo,
  type PutOptions,
  type RegistryHost,
  type StoredObject,
} from '../static/host';
import { encodeRfc3986, payloadHash, signRequest } from './sigv4';

export interface S3Options {
  /** Defaults to `https://s3.<region>.amazonaws.com`. Set it for Cloudflare R2, MinIO and other S3-compatible stores. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** `https://host/bucket/key` instead of `https://bucket.host/key`. Defaults to true for a custom endpoint, false for AWS. */
  forcePathStyle?: boolean;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

type Fetch = typeof fetch;

const etagOf = (res: Response): string | undefined => res.headers.get('etag') ?? undefined;

const AWS_ENDPOINT = /(^|\.)amazonaws\.com$/;

function errorDetail(xml: string): string {
  const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1];
  const message = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1];
  return [code, message].filter(Boolean).join(': ');
}

/**
 * An S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) over `fetch`, signed with SigV4 on
 * `node:crypto`. No SDK. Errors never carry the credentials.
 */
export function s3Host(options: S3Options): RegistryHost {
  const endpoint = new URL(options.endpoint ?? `https://s3.${options.region}.amazonaws.com`);
  const pathStyle = options.forcePathStyle ?? !AWS_ENDPOINT.test(endpoint.hostname);
  const doFetch: Fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const secrets = [options.secretAccessKey, options.sessionToken, options.accessKeyId].filter(
    (s): s is string => s !== undefined && s !== '',
  );
  const redact = (text: string): string =>
    secrets.reduce((out, secret) => out.replaceAll(secret, '***'), text);

  const base = endpoint.pathname.replace(/\/$/, '');
  const urlFor = (key: string, query = ''): string => {
    const encoded = key === '' ? '' : key.split('/').map(encodeRfc3986).join('/');
    const origin = pathStyle
      ? endpoint.origin
      : `${endpoint.protocol}//${options.bucket}.${endpoint.host}`;
    const path = pathStyle ? `${base}/${encodeRfc3986(options.bucket)}` : base;
    return `${origin}${path}/${encoded}${query}`;
  };

  async function send(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: Uint8Array,
  ): Promise<Response> {
    const hash = payloadHash(body ?? '');
    const signed = signRequest({
      method,
      url,
      headers: { ...headers, 'x-amz-content-sha256': hash },
      ...(body === undefined ? {} : { body }),
      region: options.region,
      service: 's3',
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
      },
      date: now(),
    });
    try {
      return await doFetch(url, {
        method,
        headers: signed.headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      throw new HostError(
        `${method} failed: ${redact(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  const fail = async (what: string, res: Response): Promise<never> => {
    const detail = redact(errorDetail(await res.text().catch(() => '')));
    throw new HostError(
      `${what} failed with HTTP ${String(res.status)}${detail === '' ? '' : ` (${detail})`}`,
      res.status,
    );
  };

  return {
    async put(key, body, put: PutOptions) {
      assertSafeKey(key);
      const bytes = toBytes(body);
      const res = await send(
        'PUT',
        urlFor(key),
        {
          'content-type': put.contentType,
          'cache-control': put.cacheControl,
          ...(put.ifMatch === undefined ? {} : { 'if-match': put.ifMatch }),
        },
        bytes,
      );
      if (res.status === 412) throw new PreconditionFailedError(key);
      if (!res.ok) await fail(`PUT ${key}`, res);
      const etag = etagOf(res);
      return etag === undefined ? {} : { etag };
    },
    async get(key): Promise<StoredObject | undefined> {
      assertSafeKey(key);
      const res = await send('GET', urlFor(key));
      if (res.status === 404) return undefined;
      if (!res.ok) await fail(`GET ${key}`, res);
      const etag = etagOf(res);
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        ...(etag === undefined ? {} : { etag }),
      };
    },
    async head(key): Promise<ObjectInfo | undefined> {
      assertSafeKey(key);
      const res = await send('HEAD', urlFor(key));
      if (res.status === 404) return undefined;
      if (!res.ok) await fail(`HEAD ${key}`, res);
      const etag = etagOf(res);
      const length = res.headers.get('content-length');
      return {
        ...(etag === undefined ? {} : { etag }),
        ...(length === null ? {} : { size: Number(length) }),
      };
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const query = new URLSearchParams({ 'list-type': '2', prefix });
        if (token !== undefined) query.set('continuation-token', token);
        // oxlint-disable-next-line no-await-in-loop -- each page names the next
        const res = await send('GET', urlFor('', `?${query.toString().replaceAll('+', '%20')}`));
        // oxlint-disable-next-line no-await-in-loop -- throws, ends the loop
        if (!res.ok) await fail(`LIST ${prefix}`, res);
        // oxlint-disable-next-line no-await-in-loop -- each page names the next
        const xml = await res.text();
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g))
          keys.push(decodeXml(match[1] ?? ''));
        token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
        if (token !== undefined) token = decodeXml(token);
      } while (token !== undefined);
      return keys;
    },
  };
}

function decodeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
